仿照pinia，实现一个简单的状态管理库，用于存储一些全局状态。
支持state，getters，actions。
支持持久化。

不支持插件。
不支持组合式API。
不支持getters缓存。想要缓存，可以使用useMemo。 

## fwstore 使用示例

### 1. 定义状态

```ts

import { defineStore } from 'fcstore'

// 定义计数器状态
export const useCounterStore = defineStore({
  id: 'counter',
  state: () => ({
    count: 0
  }),
  getters: {
    double: (state) => state.count * 2
  },
  actions: {
    increment() {
      this.count++
    }
  }
})
```

### 2. 访问状态

```ts

import { useCounterStore } from './counter'
// 在组件中使用
const Counter:FC = () => {
    const store = useCounterStore();

    // 直接访问状态
    console.log(store.count); // 通过 Proxy 转发到 stateProxy

    // 直接访问计算属性（无缓存机制）
    console.log(store.double);

    // 基本数据结构，支持直接赋值。但不推荐。
    store.count = 10; 

    // 正确修改方式
    store.$patch({ count: 10 }); // ✅
    store.increment(); // ✅


  return (
    <div>
      <p>Count: {counter.count}</p>
      <button onClick={() => counter.increment()}>Increment</button>
    </div>
  )
}

```

### 3. 嵌套状态
```ts
// 定义嵌套状态
const useNestedStore = defineStore({
  id: 'nested',
  state: () => ({
    user: {
      name: 'Alice',
      profile: {
        age: 25
      }
    }
  })
});

// 修改深层属性
store.$patch({
  user: {
    ...store.user,
    profile: {
      age: 26
    }
  }
}); // 自动触发更新

```

### 4. 数据持久化
```ts
// 使用持久化功能
const usePersistedStore = defineStore({
  id: 'persisted',
  state: () => ({
    settings: {
      theme: 'dark',
      fontSize: 14
    }
  }),
  // 启用持久化，使用默认配置（localStorage）
  persist: true
});

// 使用自定义持久化配置
const useCustomPersistedStore = defineStore({
  id: 'customPersisted',
  state: () => ({
    userPreferences: {
      language: 'zh-CN'
    }
  }),
  // 自定义持久化配置
  persist: {
    enabled: true,
    storage: sessionStorage, // 使用sessionStorage而非localStorage
    prefix: 'app-', // 自定义前缀
    // 自定义序列化和反序列化方法
    serialize: (state) => JSON.stringify(state),
    deserialize: (data) => JSON.parse(data)
  }
});

```

### 5. 状态订阅
```ts
const store = useCounterStore()

// 监听每次状态变更
store.$subscribe(() => {
    console.log('Store updated')
})
```







