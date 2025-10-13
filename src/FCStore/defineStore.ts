/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 一个接近 Pinia 的微型状态管理仓库。
 *
 * 特性：
 * - 支持 State：管理应用的状态数据。
 * - 支持 Getters：派生状态，并具有缓存机制。
 * - 支持 Actions：封装业务逻辑，可异步操作。
 * - 支持 持久化：通过配置将状态存储到本地存储。
 *
 * 不支持：
 * - 插件系统
 * - 组合式 API
 *
 * @module FCStore/defineStore
 */
import { useEffect, useReducer } from "react";

// ===== 类型定义 =====

/**
 * `defineStore` 函数的返回类型。
 * 它既是一个可以在 React 组件中使用的 Hook，也附加了一个 `.get()` 方法用于在非组件环境下安全地获取 store 实例。
 * @template S - 状态对象的类型
 * @template G - Getters 对象的类型
 * @template A - Actions 对象的类型
 */
export type UseStore<S extends object, G extends Record<string, (state: S) => any>, A> = (() => StoreInstance<S, G, A>) & {
	/**
	 * 在非组件环境下获取 store 实例的方法。
	 * @returns Store 实例
	 */
	get: () => StoreInstance<S, G, A>;
};

/**
 * 状态订阅器的监听函数类型。
 * 当 store 状态发生变化时，会调用此函数。
 * @template S - 状态对象的类型
 * @param state - 当前的完整状态
 * @param changes - 发生变化的部分状态
 */
type Listener<S> = (state: S, changes: Partial<S>) => void;

/**
 * 将类型 T 的所有属性变为可写（移除 readonly 修饰符）。
 * @template T - 原始类型
 */
type Writable<T> = {
	-readonly [K in keyof T]: T[K];
};

/**
 * Store 实例的类型。
 * 包含了可写的 State 属性、只读的 Getters 返回值、只读的 Actions 方法以及 StoreWithState 提供的额外属性。
 * @template S - 状态对象的类型
 * @template G - Getters 对象的类型
 * @template A - Actions 对象的类型
 */
type StoreInstance<S extends object, G extends Record<string, (state: S) => any>, A> = Writable<S> & Readonly<GettersReturnTypes<G>> & Readonly<A> & Readonly<StoreWithState<S>>;

/**
 * 持久化配置选项的类型。
 */
export type PersistOptions = {
	/** 是否启用持久化，默认为 true */
	enabled?: boolean;
	/** 存储机制，默认为 localStorage */
	storage?: Storage;
	/** 存储键的前缀，默认为 "qm-store-" */
	prefix?: string;
	/** 序列化函数，默认为 JSON.stringify */
	serialize?: (value: unknown) => string;
	/** 反序列化函数，默认为 JSON.parse */
	deserialize?: (value: string) => unknown;
};

/**
 * Store 实例中与状态相关的额外属性和方法。
 * @template S - 状态对象的类型
 */
export type StoreWithState<S> = {
	/** Store 的唯一标识符 */
	$id: string;
	/** 原始状态对象 */
	$state: S;
	/**
	 * 批量更新状态的方法。
	 * @param partialState - 部分状态对象，用于合并到当前状态
	 */
	$patch: (partialState: Partial<S>) => void;
	/**
	 * 订阅状态变化的方法。
	 * @param listener - 状态变化监听函数
	 * @returns 取消订阅函数
	 */
	$subscribe: (listener: Listener<S>) => () => void;
	/** 重置状态到初始值的方法 */
	$reset: () => void;
};

/**
 * Getters 返回值的类型映射。
 * @template G - Getters 对象的类型
 */
export type GettersReturnTypes<G> = {
	readonly [K in keyof G]: G[K] extends (...args: any[]) => infer R ? R : never;
};

// ===== 全局响应式系统 =====

/**
 * 存储所有 store 实例的 Map，键为 store 的 ID。
 */
const storeInstances = new Map<string, unknown>();
/**
 * 存储所有 getter 缓存值的 Map，键为 `storeId/getterName`。
 */
const globalGetterCache = new Map<string, any>();
/**
 * 存储状态属性到依赖该属性的 getter 列表的 Map。
 * 键为 `storeId/propertyName`，值为依赖该属性的 getter 键集合。
 */
const globalPropertyToGetters = new Map<string, Set<string>>();
/**
 * 存储 getter 到其所依赖的状态属性列表的 Map。
 * 键为 `storeId/getterName`，值为该 getter 依赖的状态属性键集合。
 */
const globalGetterToDependencies = new Map<string, Set<string>>(); // 用于追踪每个 getter 的依赖
/**
 * 当前正在计算的 getter 栈，用于依赖收集。
 */
const globalActiveGetters: string[] = [];

declare const module: {
	hot?: {
		accept: () => void;
		dispose: (callback: () => void) => void;
	};
};

interface ImportMeta {
	hot?: {
		on: (event: string, callback: (payload: any) => void) => void;
	};
	env?: {
		MODE: string;
	};
}

/**
 * Vite 环境下的热模块替换 (HMR) 处理。
 * 在 Vite 模块更新前，清空所有缓存和实例，确保状态重置。
 */
if ((import.meta as ImportMeta).hot) {
	(import.meta as ImportMeta).hot?.on("vite:beforeUpdate", () => {
		// 清空所有 store 实例，强制重新创建
		storeInstances.clear();
		// 清空所有 getter 缓存
		globalGetterCache.clear();
		// 清空属性到 getter 的依赖映射
		globalPropertyToGetters.clear();
		// 清空 getter 到属性的依赖映射
		globalGetterToDependencies.clear();
	});
}

/**
 * Webpack 环境下的热模块替换 (HMR) 处理。
 * 在 Webpack 模块更新时，接受更新并清空所有缓存和实例，确保状态重置。
 */
if (typeof module !== "undefined" && module.hot) {
	module.hot.accept();
	module.hot.dispose(() => {
		// 清空所有 store 实例，强制重新创建
		storeInstances.clear();
		// 清空所有 getter 缓存
		globalGetterCache.clear();
		// 清空属性到 getter 的依赖映射
		globalPropertyToGetters.clear();
		// 清空 getter 到属性的依赖映射
		globalGetterToDependencies.clear();
	});
}

// ===== 默认配置 =====

/**
 * 默认的持久化配置。
 */
const defaultPersistOptions: PersistOptions = {
	enabled: true, // 默认启用持久化
	storage: typeof window !== "undefined" ? window.localStorage : undefined, // 默认使用 localStorage
	prefix: "qm-store-", // 默认存储键前缀
	serialize: JSON.stringify, // 默认序列化方法
	deserialize: JSON.parse, // 默认反序列化方法
};

// ===== `defineStore` 核心实现 =====

/**
 * 定义一个 Store。
 * @template S - 状态对象的类型。
 * @template G - Getters 对象的类型。
 * @template A - Actions 对象的类型。
 * @param id - Store 的唯一标识符。
 * @param options - Store 的配置选项。
 * @param options.state - 返回初始状态的函数。
 * @param options.getters - 定义派生状态的 Getters 对象。
 * @param options.actions - 定义修改状态和业务逻辑的 Actions 对象。
 * @param options.persist - 持久化配置，可以是 boolean 或 PersistOptions 对象。
 * @param options.debug - 是否启用调试模式，会在控制台输出状态变化日志。
 * @returns 一个 UseStore Hook，用于在组件中获取 Store 实例，并提供 `.get()` 方法在非组件环境获取。
 */
function defineStore<S extends object, G extends Record<string, (...args: any[]) => any>, A extends Record<string, (...args: any[]) => any>>(
	id: string,
	options: {
		state: () => S;
		getters?: G & ThisType<S & GettersReturnTypes<G>>;
		actions?: A & ThisType<S & GettersReturnTypes<G> & StoreWithState<S> & A>;
		persist?: boolean | PersistOptions;
		debug?: boolean;
	}
): UseStore<S, G, A> {
	if (storeInstances.has(id)) {
		return storeInstances.get(id) as UseStore<S, G, A>;
	}

	// 标记是否正在进行状态更新，用于避免重复触发订阅者通知
	let isUpdating = false;
	// 存储当前批次状态变化的详情
	let currentChanges: Partial<S> = {};
	// 初始化状态
	const state = options.state();
	// 存储状态订阅者
	const subscribers = new Set<Listener<S>>();

	/**
	 * 依赖追踪代理。
	 * 当 getter 访问 state 属性时，会通过此代理进行依赖收集。
	 */
	const depTrackingProxy = new Proxy(state, {
		get(target, prop) {
			// 如果当前有正在计算的 getter，则进行依赖收集
			if (globalActiveGetters.length > 0) {
				const propKey = `${id}/${String(prop)}`;
				// 确保该属性在 globalPropertyToGetters 中有对应的 Set
				if (!globalPropertyToGetters.has(propKey)) {
					globalPropertyToGetters.set(propKey, new Set());
				}
				const dependents = globalPropertyToGetters.get(propKey)!;

				// 将当前所有活跃的 getter 添加为该属性的依赖
				globalActiveGetters.forEach((getterKey) => dependents.add(getterKey));

				// 将该属性添加为最内层活跃 getter 的依赖
				const currentGetterKey = globalActiveGetters[globalActiveGetters.length - 1];
				if (!globalGetterToDependencies.has(currentGetterKey)) {
					globalGetterToDependencies.set(currentGetterKey, new Set());
				}
				globalGetterToDependencies.get(currentGetterKey)!.add(propKey);
			}
			return Reflect.get(target, prop);
		},
	});

	// 处理持久化配置
	const persistOptions: PersistOptions | false = options.persist ? (typeof options.persist === "boolean" ? defaultPersistOptions : { ...defaultPersistOptions, ...options.persist }) : false;

	// 如果启用持久化，则从存储中恢复状态
	if (persistOptions && persistOptions.enabled && persistOptions.storage) {
		try {
			const storageKey = `${persistOptions.prefix || ""}${id}`;
			const storedState = persistOptions.storage.getItem(storageKey);
			const deserializedState = storedState ? persistOptions.deserialize!(storedState) : {};
			Object.assign(state, deserializedState as Partial<S>);
		} catch (e) {
			console.error(`[Store] 从持久化存储恢复状态失败 (id: ${id}):`, e);
		}
	}

	/**
	 * 通知所有订阅者状态已更新。
	 * @param changes - 发生变化的部分状态。
	 */
	function notifySubscribers(changes: Partial<S>) {
		if (Object.keys(changes).length === 0) return;
		subscribers.forEach((listener) => listener(state, changes));
		persistState(); // 状态变化后进行持久化
	}

	/**
	 * 将当前状态持久化到存储中。
	 */ function persistState() {
		if (persistOptions && persistOptions.enabled && persistOptions.storage) {
			try {
				const storageKey = `${persistOptions.prefix || ""}${id}`;
				persistOptions.storage!.setItem(storageKey, persistOptions.serialize!(state));
			} catch (e) {
				console.error(`[Store] 持久化状态到存储失败 (id: ${id}):`, e);
			}
		}
	}

	const store: Record<string, any> = {
		$id: id, // Store 的唯一标识符
		/**
		 * 获取当前状态。
		 */
		get $state() {
			return state;
		},
		/**
		 * 批量更新状态。
		 * @param partialState - 需要更新的部分状态。
		 */
		$patch(partialState: Partial<S>) {
			const oldState = options.debug ? { ...state } : null; // 调试模式下记录旧状态
			// 记录本次 patch 导致的状态变化，用于通知订阅者
			for (const key in partialState) {
				if (Object.prototype.hasOwnProperty.call(partialState, key)) {
					(currentChanges as any)[key] = state[key as keyof S];
				}
			}

			isUpdating = true; // 标记正在更新状态
			try {
				Object.assign(state, partialState); // 合并部分状态到当前状态
			} finally {
				isUpdating = false; // 结束更新标记
				if (options.debug) {
					// 调试模式下输出状态变化日志
					console.groupCollapsed(`[Store patch] ${id} @ ${new Date().toLocaleTimeString()}`);
					console.log("%c prev state", "color: #9E9E9E; font-weight: bold;", oldState);
					console.log("%c patch", "color: #03A9F4; font-weight: bold;", partialState);
					console.log("%c next state", "color: #4CAF50; font-weight: bold;", { ...state });
					console.groupEnd();
				}
				notifySubscribers(currentChanges); // 通知订阅者状态已更新
				currentChanges = {}; // 清空本次变化记录
			}
		},
		/**
		 * 订阅状态变化。
		 * @param listener - 状态变化监听函数。
		 * @returns 取消订阅函数。
		 */
		$subscribe(listener: Listener<S>) {
			subscribers.add(listener);
			return () => subscribers.delete(listener);
		},
		/**
		 * 重置状态到初始值。
		 */
		$reset() {
			this.$patch(options.state());
		},
	};

	/**
	 * Store 的代理对象，用于拦截属性访问和修改。
	 * 使得可以直接通过 store.property 访问 state 属性，并通过 store.property = value 修改 state 属性。
	 */
	const storeProxy = new Proxy(store, {
		get(target, prop) {
			// 如果属性存在于 store 自身（如 $id, $state, $patch 等），则直接返回
			if (Reflect.has(target, prop)) {
				return Reflect.get(target, prop);
			}
			// 否则，从 depTrackingProxy（即原始 state）中获取，用于依赖收集
			return Reflect.get(depTrackingProxy, prop);
		},
		set(_target, prop, value) {
			// 如果尝试设置的属性不在 state 中，则发出警告
			if (!Reflect.has(state, prop)) {
				console.warn(`[Store warning] 不能直接设置非state属性 "${String(prop)}". 请在action中操作。`);
				return false;
			}

			const key = prop as keyof S;
			const prev = state[key]; // 记录旧值
			const changed = prev !== value; // 判断值是否发生变化
			const result = Reflect.set(state, prop, value); // 设置新值到 state

			if (changed) {
				const propKey = `${id}/${String(prop)}`;
				// 获取依赖此属性的所有 getter
				const gettersToInvalidate = globalPropertyToGetters.get(propKey);
				if (gettersToInvalidate) {
					// 使这些 getter 的缓存失效
					gettersToInvalidate.forEach((getterKey) => {
						globalGetterCache.delete(getterKey);
					});
				}

				(currentChanges as any)[key] = prev; // 记录本次变化，用于通知订阅者
			}

			// 如果状态发生变化且当前不在批量更新中，则通知订阅者
			if (changed && !isUpdating) {
				if (options.debug) {
					// 调试模式下输出状态变化日志
					console.groupCollapsed(`[Store mutation] ${id} -> ${String(prop)} @ ${new Date().toLocaleTimeString()}`);
					console.log("%c prev value", "color: #9E9E9E; font-weight: bold;", prev);
					console.log("%c next value", "color: #4CAF50; font-weight: bold;", value);
					console.groupEnd();
				}
				notifySubscribers(currentChanges); // 通知订阅者状态已更新
				currentChanges = {}; // 清空本次变化记录
			}

			return result;
		},
	}) as StoreInstance<S, G, A>;

	if (options.getters) {
		// 遍历所有定义的 getter
		for (const [key, getter] of Object.entries(options.getters)) {
			// 为 store 实例定义 getter 属性
			Object.defineProperty(store, key, {
				get: () => {
					const getterKey = `${id}/${key}`;

					// 如果 getter 缓存中存在，则直接返回缓存值
					if (globalGetterCache.has(getterKey)) {
						// 如果我们处于另一个 getter 的计算上下文中，且当前 getter 已被缓存，
						// 仍然需要建立依赖关系（将当前 getter 的依赖转给外层 getter）。
						if (globalActiveGetters.length > 0) {
							const dependencies = globalGetterToDependencies.get(getterKey);
							if (dependencies) {
								const outerGetterKey = globalActiveGetters[globalActiveGetters.length - 1];
								dependencies.forEach((dep) => {
									// 建立状态属性到外层 getter 的依赖
									if (!globalPropertyToGetters.has(dep)) globalPropertyToGetters.set(dep, new Set());
									globalPropertyToGetters.get(dep)!.add(outerGetterKey);
									// 建立外层 getter 到状态属性的依赖
									if (!globalGetterToDependencies.has(outerGetterKey)) globalGetterToDependencies.set(outerGetterKey, new Set());
									globalGetterToDependencies.get(outerGetterKey)!.add(dep);
								});
							}
						}
						return globalGetterCache.get(getterKey);
					}

					// 将当前 getter 加入活跃 getter 栈，开始依赖收集
					globalActiveGetters.push(getterKey);
					// 清除旧的依赖，准备重新收集
					globalGetterToDependencies.delete(getterKey);
					// 调用原始 getter 函数计算值
					const value = getter.call(storeProxy);
					// 从活跃 getter 栈中移除当前 getter，结束依赖收集
					globalActiveGetters.pop();
					// 缓存 getter 的计算结果
					globalGetterCache.set(getterKey, value);
					return value;
				},
				enumerable: true,
			});
		}
	}

	if (options.actions) {
		// 遍历所有定义的 action
		for (const key in options.actions) {
			const action = options.actions[key];
			// 为 store 实例定义 action 方法
			store[key] = function (...args: Parameters<typeof action>): ReturnType<typeof action> {
				const oldState = options.debug ? { ...state } : null; // 调试模式下记录旧状态
				isUpdating = true; // 标记正在更新状态
				// result 的类型可以是 action 的返回值，也可以是 Promise<action 的返回值>，或者 undefined
				let result: ReturnType<typeof action> | Promise<ReturnType<typeof action>> | undefined = undefined;
				/**
				 * 通知订阅者并处理调试日志的内部函数。
				 */
				const notify = () => {
					isUpdating = false; // 结束更新标记
					if (options.debug) {
						// 调试模式下输出 action 执行日志
						console.groupCollapsed(`[Store action] ${id} -> ${key} @ ${new Date().toLocaleTimeString()}`);
						console.log("%c prev state", "color: #9E9E9E; font-weight: bold;", oldState);
						console.log("%c args", "color: #03A9F4; font-weight: bold;", args);
						console.log("%c next state", "color: #4CAF50; font-weight: bold;", { ...state });
						console.groupEnd();
					}
					notifySubscribers(currentChanges); // 通知订阅者状态已更新
					currentChanges = {}; // 清空本次变化记录
				};

				try {
					result = action.apply(storeProxy, args); // 执行原始 action
				} finally {
					// 如果 action 返回的不是 Promise，则立即通知订阅者
					if (!(result instanceof Promise)) {
						notify();
					}
				}

				// 如果 action 返回 Promise，则在 Promise 结束后通知订阅者
				if (result instanceof Promise) {
					return result.finally(notify) as unknown as ReturnType<typeof action>;
				}
				return result as ReturnType<typeof action>;
			};
		}
	}

	/**
	 * 用于在 React 组件中使用的 Hook。
	 * 当 Store 状态变化时，会强制组件重新渲染。
	 */
	const useStore = Object.assign(
		() => {
			// 使用 useReducer 强制组件更新
			const [, forceUpdate] = useReducer((x) => x + 1, 0);

			// 在组件挂载时订阅状态变化，在卸载时取消订阅
			useEffect(() => {
				const unsubscribe = storeProxy.$subscribe(() => forceUpdate());
				return unsubscribe;
			}, []);

			return storeProxy; // 返回 Store 实例
		},
		{
			/**
			 * 在非组件环境下获取 Store 实例。
			 * @returns Store 实例。
			 */
			get: () => storeProxy,
		}
	) as UseStore<S, G, A>;

	// 将创建的 useStore 实例存储起来，以便重复使用
	storeInstances.set(id, useStore);

	return useStore; // 返回 useStore Hook
}

export default defineStore; // 导出 defineStore 函数
