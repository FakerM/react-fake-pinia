/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FCStore - 一个轻量级、高性能的 React 状态管理库。
 * 设计理念源于 Pinia，极简 API，完美契合 React。
 *
 * 核心特性：
 * 1. 极简 API：类似 Pinia 的 `defineStore`，零样板代码。
 * 2. 高性能：基于 Proxy 的浅层拦截，配合 $patch 进行批量更新。
 * 3. HMR 支持：内置热模块替换，开发时状态不丢失。
 * 4. 持久化：开箱即用的状态持久化支持。
 * 5. React Hooks：完美契合 React 函数式组件生态。
 */
import { useEffect, useReducer } from "react";

declare const module: {
	hot?: {
		accept: () => void;
		dispose: (callback: () => void) => void;
	};
};

/**
 * `defineStore` 返回的 Hook 类型。
 * 除了作为 Hook 使用外，还挂载了 `get()` 方法，用于在组件外部（如工具函数、其他 Store）中访问 Store 实例。
 */
export type UseStore<S extends object, A extends Record<string, any>> = (() => Store<S, A>) & {
	/**
	 * 获取 Store 的原始实例（非 Hook）。
	 * 适用于组件外部或跨 Store 调用的场景。
	 */
	get: () => Store<S, A>;
};

/**
 * 状态变更监听器。
 * @param state - 变更后的最新状态快照。
 * @param prevState - 变更前的状态快照。
 * @param changes - 本次变更的属性集合（Delta）。
 */
type Listener<S> = (state: S, prevState: S, changes: Partial<S>) => void;

/**
 * 完整的 Store 实例类型。
 * 包含：State 属性 + Actions 方法 + 内置 API ($patch, $reset 等)。
 */
export type Store<S, A> = S & A & StoreWithState<S>;

/**
 * 持久化配置选项。
 */
export type PersistOptions = {
	/** 是否启用持久化 */
	enabled?: boolean;
	/** 存储引擎，默认为 localStorage */
	storage?: Storage;
	/** 存储键前缀，防止键名冲突 */
	prefix?: string;
	/** 序列化方法，默认为 JSON.stringify */
	serialize?: (value: unknown) => string;
	/** 反序列化方法，默认为 JSON.parse */
	deserialize?: (value: string) => unknown;
};

/**
 * Store 内置 API 接口。
 */
export type StoreWithState<S> = {
	/** Store 的唯一标识符 */
	$id: string;
	/** 原始状态对象 */
	$state: S;
	/**
	 * 批量更新状态。
	 * 相比直接赋值，`$patch` 会合并多次变更为一次通知，优化性能。
	 * 对于深层对象更新，必须使用此方法。
	 */
	$patch: (partialState: Partial<S>) => void;
	/**
	 * 订阅状态变更。
	 * @returns 取消订阅的函数。
	 */
	$subscribe: (listener: Listener<S>) => () => void;
	/** 重置状态为初始值 */
	$reset: () => void;
};

// 全局状态缓存，用于单例模式和 HMR 状态保持
const storeInstances = new Map<string, any>();
const HMR_CONTEXT_KEY = Symbol("HMR_CONTEXT");

/**
 * 应用变更并返回有效变更集和旧值集
 */
function applyChanges<S>(state: S, partial: Partial<S>) {
	const effectiveChanges: Partial<S> = {};
	let hasChanges = false;

	for (const [key, value] of Object.entries(partial)) {
		const k = key as keyof S;
		const oldValue = state[k];
		// 基础类型严格比较，对象类型总是认为变更（支持外部 mutation）
		if (oldValue === value && (typeof value !== "object" || value === null)) continue;

		(state as any)[k] = value;
		(effectiveChanges as any)[k] = value;
		hasChanges = true;
	}

	return { hasChanges, effectiveChanges };
}

/**
 * 创建 Action 的高阶包装函数。
 *
 * 职责：
 * 1. 批量更新事务：在 Action 执行期间，暂停通知，收集所有变更。
 * 2. 异步支持：自动处理 Promise，确保异步操作结束后正确触发通知。
 * 3. 错误处理：在 Action 抛出异常时正确回滚更新锁。
 */
function createActionWrapper(storeProxy: any, actionFn: (...args: any[]) => any, ctx: any) {
	return (...args: any[]) => {
		const previousIsUpdating = ctx.isUpdating;
		// 开启批量更新事务
		if (!ctx.isUpdating) {
			ctx.isUpdating = true;
			ctx.batchOldState = { ...ctx.state }; // 快照当前状态
			ctx.batchChanges = {}; // 重置变更累积器
		}

		// 事务结束后的提交逻辑
		const commit = () => {
			if (!previousIsUpdating) {
				ctx.isUpdating = false;
				// 如果有变更，则触发一次合并通知
				if (Object.keys(ctx.batchChanges).length > 0) {
					ctx.notify(ctx.batchOldState, ctx.batchChanges);
					ctx.batchChanges = {};
				}
			}
		};

		try {
			// 显式绑定 this 为 storeProxy，确保 Action 内能通过 this 访问 State/Actions
			const res = actionFn.apply(storeProxy, args);
			// 处理异步 Action
			if (res instanceof Promise) return res.finally(commit);
			// 处理同步 Action
			commit();
			return res;
		} catch (e) {
			// 异常回滚：确保锁被释放，避免 Store 锁死
			if (!previousIsUpdating) ctx.isUpdating = false;
			throw e;
		}
	};
}

/**
 * 处理热模块替换 (HMR)。
 *
 * 策略：
 * 1. State：增量补全。保留现有状态值，仅合并新代码中新增的字段。
 * 2. Actions：热替换。直接用新定义覆盖旧定义，立即生效。
 */
function handleHMR(id: string, options: any) {
	const useStore = storeInstances.get(id);
	const storeProxy = useStore.get();
	const ctx = storeProxy[HMR_CONTEXT_KEY];

	// 1. 补全 State (处理新增字段)
	// 注意：不删除旧字段，以防止 HMR 导致的数据意外丢失
	const newState = options.state();
	for (const key in newState) {
		if (!(key in ctx.state)) {
			const val = newState[key];
			// 浅拷贝防止引用污染
			if (Array.isArray(val)) ctx.state[key] = [...val] as any;
			else if (typeof val === "object" && val !== null) ctx.state[key] = { ...val } as any;
			else ctx.state[key] = val;
		}
	}

	// 2. 热替换 Actions
	if (options.actions) {
		for (const key in options.actions) {
			storeProxy[key] = createActionWrapper(storeProxy, options.actions[key], ctx);
		}
	}

	return useStore;
}

// 核心实现

/**
 * 定义一个 Store。
 *
 * @param id - Store 的唯一标识符。
 * @param options - 配置选项 (State, Actions, Persist)。
 */
function defineStore<S extends object, A extends Record<string, any>>(
	id: string,
	options: {
		state: () => S;
		actions?: A & ThisType<S & A & StoreWithState<S>>;
		persist?: boolean | PersistOptions;
		debug?: boolean;
	}
): UseStore<S, A> {
	// HMR 拦截：如果 Store 已存在，进入热更新流程
	if (storeInstances.has(id)) return handleHMR(id, options) as UseStore<S, A>;

	// 内部上下文，封装了 Store 的核心状态和私有属性
	const ctx = {
		state: options.state(),
		subscribers: new Set<Listener<S>>(),
		isUpdating: false, // 批量更新锁
		batchOldState: {} as S, // 批量更新前的状态快照
		batchChanges: {} as Partial<S>, // 批量更新期间的变更累积
		notify: null as any,
	};

	// 持久化处理
	const pOpts = options.persist
		? {
				enabled: true,
				storage: window.localStorage,
				prefix: "qm-store-",
				serialize: JSON.stringify,
				deserialize: JSON.parse,
				...(typeof options.persist === "object" ? options.persist : {}),
		  }
		: undefined;

	// 启动时恢复持久化状态
	if (pOpts?.enabled && pOpts.storage) {
		try {
			const data = pOpts.storage.getItem(`${pOpts.prefix}${id}`);
			if (data) Object.assign(ctx.state, pOpts.deserialize!(data));
		} catch (e) {
			console.error(`[Store] Load failed:`, e);
		}
	}

	// 通知订阅者并持久化
	ctx.notify = (prevState: S, changes: Partial<S>) => {
		// 开发环境下冻结 changes，防止订阅者意外修改
		if (process.env.NODE_ENV !== "production") Object.freeze(changes);
		ctx.subscribers.forEach((l) => l(ctx.state, prevState, changes));
		if (pOpts?.enabled && pOpts.storage) {
			try {
				pOpts.storage.setItem(`${pOpts.prefix}${id}`, pOpts.serialize!(ctx.state));
			} catch (e) {
				console.error(`[Store] Save failed:`, e);
			}
		}
	};

	const store: any = {
		$id: id,
		[HMR_CONTEXT_KEY]: ctx, // 暴露上下文给 HMR
		get $state() {
			return ctx.state;
		},
		$patch(partial: Partial<S>) {
			// 在修改前进行快照，确保 prevState 的准确性
			const oldState = { ...ctx.state };
			const { hasChanges, effectiveChanges } = applyChanges(ctx.state, partial);
			if (!hasChanges) return;

			if (ctx.isUpdating) {
				// 事务中：仅累积变更
				Object.assign(ctx.batchChanges, effectiveChanges);
			} else {
				// 事务外：立即通知
				ctx.notify(oldState, effectiveChanges);
			}
		},
		$subscribe(fn: Listener<S>) {
			if (ctx.subscribers.has(fn)) console.warn(`[Store] Listener already attached to store "${id}".`);
			ctx.subscribers.add(fn);
			return () => ctx.subscribers.delete(fn);
		},
		$reset() {
			const newState = options.state();
			const oldState = { ...ctx.state };
			const changes: Partial<S> = {};
			let hasChanges = false;

			// 1. 删除多余字段
			for (const key in ctx.state) {
				if (!(key in newState)) {
					delete (ctx.state as any)[key];
					(changes as any)[key] = undefined;
					hasChanges = true;
				}
			}
			// 2. 覆盖/重置字段
			for (const key in newState) {
				const newVal = newState[key];
				const oldVal = ctx.state[key];
				if (oldVal !== newVal) {
					ctx.state[key] = newVal;
					(changes as any)[key] = newVal;
					hasChanges = true;
				}
			}
			if (hasChanges) ctx.notify(oldState, changes);
		},
	};

	// 代理拦截
	const storeProxy = new Proxy(store, {
		get(target, prop) {
			// 优先返回 Store 自身属性 (Actions, $patch 等)
			if (prop in target) return target[prop];
			// 其次返回 State 属性
			return ctx.state[prop as keyof S];
		},
		set(target, prop, value) {
			// 1. 允许修改 Store 自身属性 (用于 HMR 更新 Actions)
			if (prop in target) {
				target[prop] = value;
				return true;
			}
			// 2. 安全检查：禁止动态添加 State 根属性
			if (!(prop in ctx.state)) {
				console.warn(`[Store] Set unknown prop "${String(prop)}"`);
				return false;
			}
			// 3. 响应式更新 State
			const oldValue = ctx.state[prop as keyof S];
			// 基础类型严格比较，对象类型总是认为变更
			if (oldValue !== value || (typeof value === "object" && value !== null)) {
				if (ctx.isUpdating) {
					(ctx.batchChanges as any)[prop] = value;
					(ctx.state as any)[prop] = value;
				} else {
					const oldState = { ...ctx.state };
					(ctx.state as any)[prop] = value;
					ctx.notify(oldState, { [prop]: value } as any);
				}
			}
			return true;
		},
	});

	// 挂载 Actions
	if (options.actions) {
		const actions = options.actions;
		for (const key in actions) {
			store[key] = createActionWrapper(storeProxy, actions[key], ctx);
		}
	}

	// Hook 创建
	const useStore = Object.assign(
		() => {
			// 使用 useReducer 强制组件重渲染
			const [, forceUpdate] = useReducer((c) => c + 1, 0);
			// 组件挂载时订阅，卸载时自动取消
			useEffect(() => storeProxy.$subscribe(forceUpdate), []);
			return storeProxy;
		},
		{ get: () => storeProxy }
	);

	storeInstances.set(id, useStore);

	// Webpack HMR 支持
	if (typeof module !== "undefined" && module.hot) {
		module.hot.accept();
		module.hot.dispose(() => {
			storeInstances.clear();
		});
	}

	return useStore as any;
}

export default defineStore;
