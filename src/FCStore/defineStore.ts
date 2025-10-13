/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 一个接近pinia的微型状态管理仓库。
 * 支持state，getters，actions。
 * 支持持久化。
 * 支持getters缓存。
 *
 * 不支持插件。
 * 不支持组合式API。
 */
import { useEffect, useReducer } from "react";

// ===== 类型定义 =====

/**
 * `defineStore` 函数的返回类型。
 * 它既是一个可以在组件中使用的Hook，又附加了一个.get()方法用于在非组件环境下安全地获取store实例。
 */
export type UseStore<S extends object, G extends Record<string, (state: S) => any>, A> = (() => StoreInstance<S, G, A>) & {
	get: () => StoreInstance<S, G, A>;
};

type Listener<S> = (state: S, changes: Partial<S>) => void;
type Writable<T> = {
	-readonly [K in keyof T]: T[K];
};
type StoreInstance<S extends object, G extends Record<string, (state: S) => any>, A> = Writable<S> & Readonly<GettersReturnTypes<G>> & Readonly<A> & Readonly<StoreWithState<S>>;
export type PersistOptions = {
	enabled?: boolean;
	storage?: Storage;
	prefix?: string;
	serialize?: (value: unknown) => string;
	deserialize?: (value: string) => unknown;
};
export type StoreWithState<S> = {
	$id: string;
	$state: S;
	$patch: (partialState: Partial<S>) => void;
	$subscribe: (listener: Listener<S>) => () => void;
	$reset: () => void;
};
export type GettersReturnTypes<G> = {
	readonly [K in keyof G]: G[K] extends (...args: any[]) => infer R ? R : never;
};

// ===== 全局响应式系统 =====

const storeInstances = new Map<string, unknown>();
const globalGetterCache = new Map<string, any>();
const globalPropertyToGetters = new Map<string, Set<string>>();
const globalGetterToDependencies = new Map<string, Set<string>>(); // To track dependencies of each getter
const globalActiveGetters: string[] = [];

declare const module: {
	hot?: {
		accept: () => void;
		dispose: (callback: () => void) => void;
	};
};
if (import.meta.hot) {
	import.meta.hot.on("vite:beforeUpdate", () => {
		storeInstances.clear();
		globalGetterCache.clear();
		globalPropertyToGetters.clear();
		globalGetterToDependencies.clear();
	});
}
if (typeof module !== "undefined" && module.hot) {
	module.hot.accept();
	module.hot.dispose(() => {
		storeInstances.clear();
		globalGetterCache.clear();
		globalPropertyToGetters.clear();
		globalGetterToDependencies.clear();
	});
}

// ===== 默认配置 =====

const defaultPersistOptions: PersistOptions = {
	enabled: true,
	storage: typeof window !== "undefined" ? window.localStorage : undefined,
	prefix: "qm-store-",
	serialize: JSON.stringify,
	deserialize: JSON.parse,
};

// ===== `defineStore` 核心实现 =====

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

	let isUpdating = false;
	let currentChanges: Partial<S> = {};
	const state = options.state();
	const subscribers = new Set<Listener<S>>();

	const depTrackingProxy = new Proxy(state, {
		get(target, prop) {
			if (globalActiveGetters.length > 0) {
				const propKey = `${id}/${String(prop)}`;
				if (!globalPropertyToGetters.has(propKey)) {
					globalPropertyToGetters.set(propKey, new Set());
				}
				const dependents = globalPropertyToGetters.get(propKey)!;

				// The property is a dependency for ALL currently active getters
				globalActiveGetters.forEach((getterKey) => dependents.add(getterKey));

				// And the most recent getter depends on this property
				const currentGetterKey = globalActiveGetters[globalActiveGetters.length - 1];
				if (!globalGetterToDependencies.has(currentGetterKey)) {
					globalGetterToDependencies.set(currentGetterKey, new Set());
				}
				globalGetterToDependencies.get(currentGetterKey)!.add(propKey);
			}
			return Reflect.get(target, prop);
		},
	});

	const persistOptions: PersistOptions | false = options.persist ? (typeof options.persist === "boolean" ? defaultPersistOptions : { ...defaultPersistOptions, ...options.persist }) : false;

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

	function notifySubscribers(changes: Partial<S>) {
		if (Object.keys(changes).length === 0) return;
		subscribers.forEach((listener) => listener(state, changes));
		persistState();
	}

	function persistState() {
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
		$id: id,
		get $state() {
			return state;
		},
		$patch(partialState: Partial<S>) {
			const oldState = options.debug ? { ...state } : null;
			for (const key in partialState) {
				if (Object.prototype.hasOwnProperty.call(partialState, key)) {
					(currentChanges as any)[key] = state[key as keyof S];
				}
			}

			isUpdating = true;
			try {
				Object.assign(state, partialState);
			} finally {
				isUpdating = false;
				if (options.debug) {
					console.groupCollapsed(`[Store patch] ${id} @ ${new Date().toLocaleTimeString()}`);
					console.log("%c prev state", "color: #9E9E9E; font-weight: bold;", oldState);
					console.log("%c patch", "color: #03A9F4; font-weight: bold;", partialState);
					console.log("%c next state", "color: #4CAF50; font-weight: bold;", { ...state });
					console.groupEnd();
				}
				notifySubscribers(currentChanges);
				currentChanges = {};
			}
		},
		$subscribe(listener: Listener<S>) {
			subscribers.add(listener);
			return () => subscribers.delete(listener);
		},
		$reset() {
			this.$patch(options.state());
		},
	};

	const storeProxy = new Proxy(store, {
		get(target, prop) {
			if (Reflect.has(target, prop)) {
				return Reflect.get(target, prop);
			}
			return Reflect.get(depTrackingProxy, prop);
		},
		set(_target, prop, value) {
			if (!Reflect.has(state, prop)) {
				console.warn(`[Store warning] 不能直接设置非state属性 "${String(prop)}". 请在action中操作。`);
				return false;
			}

			const key = prop as keyof S;
			const prev = state[key];
			const changed = prev !== value;
			const result = Reflect.set(state, prop, value);

			if (changed) {
				const propKey = `${id}/${String(prop)}`;
				const gettersToInvalidate = globalPropertyToGetters.get(propKey);
				if (gettersToInvalidate) {
					gettersToInvalidate.forEach((getterKey) => {
						globalGetterCache.delete(getterKey);
					});
				}

				(currentChanges as any)[key] = prev;
			}

			if (changed && !isUpdating) {
				if (options.debug) {
					console.groupCollapsed(`[Store mutation] ${id} -> ${String(prop)} @ ${new Date().toLocaleTimeString()}`);
					console.log("%c prev value", "color: #9E9E9E; font-weight: bold;", prev);
					console.log("%c next value", "color: #4CAF50; font-weight: bold;", value);
					console.groupEnd();
				}
				notifySubscribers(currentChanges);
				currentChanges = {};
			}

			return result;
		},
	}) as StoreInstance<S, G, A>;

	if (options.getters) {
		for (const [key, getter] of Object.entries(options.getters)) {
			Object.defineProperty(store, key, {
				get: () => {
					const getterKey = `${id}/${key}`;

					if (globalGetterCache.has(getterKey)) {
						// If we are inside another getter computation, and this one is cached,
						// we must still establish the dependency link.
						if (globalActiveGetters.length > 0) {
							const dependencies = globalGetterToDependencies.get(getterKey);
							if (dependencies) {
								const outerGetterKey = globalActiveGetters[globalActiveGetters.length - 1];
								dependencies.forEach((dep) => {
									// Link state -> outer getter
									if (!globalPropertyToGetters.has(dep)) globalPropertyToGetters.set(dep, new Set());
									globalPropertyToGetters.get(dep)!.add(outerGetterKey);
									// Link outer getter -> state
									if (!globalGetterToDependencies.has(outerGetterKey)) globalGetterToDependencies.set(outerGetterKey, new Set());
									globalGetterToDependencies.get(outerGetterKey)!.add(dep);
								});
							}
						}
						return globalGetterCache.get(getterKey);
					}

					globalActiveGetters.push(getterKey);
					globalGetterToDependencies.delete(getterKey); // Clear old dependencies before re-tracking
					const value = getter.call(storeProxy);
					globalActiveGetters.pop();
					globalGetterCache.set(getterKey, value);
					return value;
				},
				enumerable: true,
			});
		}
	}

	if (options.actions) {
		for (const key in options.actions) {
			const action = options.actions[key];
			store[key] = function (...args: Parameters<typeof action>): ReturnType<typeof action> {
				const oldState = options.debug ? { ...state } : null;
				isUpdating = true;
				let result;

				const notify = () => {
					isUpdating = false;
					if (options.debug) {
						console.groupCollapsed(`[Store action] ${id} -> ${key} @ ${new Date().toLocaleTimeString()}`);
						console.log("%c prev state", "color: #9E9E9E; font-weight: bold;", oldState);
						console.log("%c args", "color: #03A9F4; font-weight: bold;", args);
						console.log("%c next state", "color: #4CAF50; font-weight: bold;", { ...state });
						console.groupEnd();
					}
					notifySubscribers(currentChanges);
					currentChanges = {};
				};

				try {
					result = action.apply(storeProxy, args);
				} finally {
					if (!(result instanceof Promise)) {
						notify();
					}
				}

				if (result instanceof Promise) {
					return result.finally(notify) as ReturnType<typeof action>;
				}
				return result;
			};
		}
	}

	const useStore = Object.assign(
		() => {
			const [, forceUpdate] = useReducer((x) => x + 1, 0);

			useEffect(() => {
				const unsubscribe = storeProxy.$subscribe(() => forceUpdate());
				return unsubscribe;
			}, []);

			return storeProxy;
		},
		{
			get: () => storeProxy,
		}
	) as UseStore<S, G, A>;

	storeInstances.set(id, useStore);

	return useStore;
}

export default defineStore;
