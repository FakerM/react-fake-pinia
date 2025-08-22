/**
 * 一个接近pinia的微型状态管理仓库。
 * 支持state，getters，actions。
 * 支持持久化。
 * 
 * 不支持插件。
 * 不支持组合式API。
 * 不支持getters缓存。想要缓存，可以使用useMemo。 
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useReducer } from 'react';
type Listener<T> = (state: T) => void;


type Writable<T> = {
    -readonly [K in keyof T]: T[K];
};

type StoreInstance<
    S extends object,
    G extends Record<string, (state: S) => any>,
    A
> = Writable<S> &
    Readonly<GettersReturnTypes<G>> &
    Readonly<A> &
    Readonly<StoreWithState<S>>;



// 持久化配置类型
export type PersistOptions = {
    /** 是否启用持久化 */
    enabled?: boolean;
    /** 存储引擎，默认为localStorage */
    storage?: Storage;
    /** 存储的key前缀，默认为'qm-store-' */
    prefix?: string;
    /** 自定义序列化方法 */
    serialize?: (value: any) => string;
    /** 自定义反序列化方法 */
    deserialize?: (value: string) => any;
};

// Store基础设施类型
export type StoreWithState<S> = {
    $id: string;
    $state: S;
    $patch: (partialState: Partial<S>) => void;
    $subscribe: (listener: Listener<S>) => () => void;
    $reset: () => void;
};

// 提取getters的返回类型
export type GettersReturnTypes<G> = {
    readonly [K in keyof G]: G[K] extends (...args: any[]) => infer R ? R : never
};

// Store上下文类型
export type StoreContext<S, G> = S & GettersReturnTypes<G> & StoreWithState<S>;

/**
 * 定义Store选项
 */
export interface StoreDefinition<S extends object, G, A> {
    state: () => S;
    getters?: G;
    actions?: A;
    persist?: boolean | PersistOptions;
}

/**
* 定义仓库
* @param id 仓库的id。用于区分多仓库。
* @param options state，getters，actions的配置
* @returns 返回一个函数，调用该函数可以获取仓库实例
*/


// 存储所有store实例
const storeInstances = new Map<string, any>();

interface ImportMeta {
    hot?: {
        on: (event: string, callback: (payload: any) => void) => void;
    };
    env?: {
        MODE: string,
    }
}

// vite热更新
if ((import.meta as ImportMeta).hot) {
    (import.meta as ImportMeta).hot?.on('vite:beforeUpdate', () => {
        storeInstances.clear();
    });
}
// webpack 热更新
// Webpack HMR 安全判断（防止在 Vite 环境中抛出异常）
declare const module: any;

if (typeof module !== 'undefined' && module.hot) {
    module.hot.accept();
    module.hot.dispose(() => {
        storeInstances.clear();
    });
}

// 默认持久化配置
const defaultPersistOptions: PersistOptions = {
    enabled: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined as any,
    prefix: 'qm-store-',
    serialize: JSON.stringify,
    deserialize: JSON.parse
};

// 实际实现
export function defineStore<
    S extends object,
    G extends Record<string, (state: S) => any>,
    A
>(
    id: string,
    options: {
        state: () => S,
        getters?: G & ThisType<S>,
        actions?: A & ThisType<S & GettersReturnTypes<G> & StoreWithState<S> & A>,
        persist?: boolean | PersistOptions,
    }
): () => S & GettersReturnTypes<G> & StoreWithState<S> & A {
    // 如果已存在缓存，则直接返回缓存实例
    if (storeInstances.has(id)) {
        return () => storeInstances.get(id);
    }
    let isUpdating = false;

    // 处理持久化配置
    const persistOptions: PersistOptions | false = options.persist
        ? typeof options.persist === 'boolean'
            ? defaultPersistOptions
            : { ...defaultPersistOptions, ...options.persist }
        : false;

    // 从持久化存储中恢复状态
    let initialState: S;
    if (persistOptions && persistOptions.enabled && persistOptions.storage) {
        try {
            const storageKey = `${persistOptions.prefix || ''}${id}`;
            const storedState = persistOptions.storage.getItem(storageKey);
            if (storedState) {
                const deserializedState = persistOptions.deserialize
                    ? persistOptions.deserialize(storedState)
                    : JSON.parse(storedState);
                initialState = { ...options.state(), ...deserializedState };
            } else {
                initialState = options.state();
            }
        } catch (e) {
            console.error('从持久化存储恢复状态失败:', e);
            initialState = options.state();
        }
    } else {
        initialState = options.state();
    }

    // 防止state中定义了与系统保留字段冲突的键
    // 保留字段：$id, $state, $patch, $reset, $subscribe
    const reservedKeys = ['$id', '$state', '$patch', '$reset', '$subscribe'];
    Object.keys(initialState).forEach((key) => {
        if (reservedKeys.includes(key)) {
            throw new Error(
                `State key "${key}" 与系统保留字段冲突，请更换命名（保留字段: ${reservedKeys.join(', ')})`
            );
        }
    });

    const state = initialState;
    const subscribers = new Set<Listener<S>>();

    // 状态代理，拦截所有state的访问和修改
    const stateProxy = new Proxy(state, {
        get(target, prop) {
            return Reflect.get(target, prop);
        },
        set(target, prop, value) {
            Reflect.set(target, prop, value);
            return true;
        }
    });

    // 持久化状态到存储
    function persistState() {
        if (persistOptions && persistOptions.enabled && persistOptions.storage) {
            try {
                const storageKey = `${persistOptions.prefix || ''}${id}`;
                const serializedState = persistOptions.serialize
                    ? persistOptions.serialize(state)
                    : JSON.stringify(state);
                persistOptions.storage.setItem(storageKey, serializedState);
            } catch (e) {
                console.error('持久化状态到存储失败:', e);
            }
        }
    }


    // Store 基础对象
    const store = {
        $id: id,
        $state: stateProxy,
        $patch(partialState: Partial<S>) {
            isUpdating = true;
            Object.entries(partialState).forEach(([key, value]) => {
                storeProxy[key as keyof S] = value;
            });
            isUpdating = false;
            notifySubscribers();
        },
        $subscribe(listener: Listener<S>) {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        $reset() {
            isUpdating = true;
            Object.assign(state, options.state());
            isUpdating = false;
            notifySubscribers();
        }
    } as any; // 使用any临时断言，后面会具体类型化

    // Getters 绑定
    if (options.getters) {
        Object.entries(options.getters).forEach(([key, getter]) => {
            Object.defineProperty(store, key, {
                get: () => {
                    return getter(stateProxy);
                },
                enumerable: true
            });
        });
    }

    // 复制state到store
    Object.keys(state).forEach(key => {
        if (!(key in store)) {
            Object.defineProperty(store, key, {
                get: () => state[key as keyof S],
                set: (value) => {
                    state[key as keyof S] = value;
                },
                enumerable: true
            });
        }
    });

    // Actions 绑定
    if (options.actions) {
        Object.entries(options.actions).forEach(([key, action]) => {
            (store as any)[key] = function (...args: any[]) {
                isUpdating = true;
                // 使用类型断言确保正确的上下文和参数类型
                const result = action.apply(storeProxy, args);
                if (result instanceof Promise) {
                    return result.finally(() => {
                        isUpdating = false;
                        notifySubscribers();
                    });
                }
                isUpdating = false;
                notifySubscribers();
                return result;
            };
        });
    }
    // 通知订阅者，状态更新
    function notifySubscribers() {
        subscribers.forEach(listener => listener(store.$state));
        persistState();
    }
    // 创建访问代理
    const storeProxy = new Proxy(store, {
        get(target, prop) {
            if (prop in target) return Reflect.get(target, prop);
            return Reflect.get(stateProxy, prop);
        },
        set(_target, prop, value) {
            const descriptor = Reflect.getOwnPropertyDescriptor(state, prop);

            // 如果不是 state 自身的属性（即 prop 不是 state 的 key），则不处理
            if (!descriptor) {
                console.warn(`[Store warning] 不能设置非state属性 "${String(prop)}"`);
                return false;
            }

            const prev = state[prop as keyof typeof state];
            const changed = prev !== value;

            const result = Reflect.set(state, prop, value);

            if (changed && !isUpdating) {
                notifySubscribers();
            }

            return result;
        }
    });
    storeInstances.set(id, storeProxy);
    // 返回 Hook
    return function useStore() {
        const [, forceUpdate] = useReducer(x => x + 1, 0);
        useEffect(() => {
            const unsubscribe = storeProxy.$subscribe(() => {
                forceUpdate();
            });
            return unsubscribe;
        }, []);
        return storeProxy as StoreInstance<S, G, A>;
    };
}

export default defineStore;