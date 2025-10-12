# FCStore 使用手册

FCStore 是一个为 React 设计的、受 [Pinia](https://pinia.vuejs.org/) 启发的微型状态管理库。它提供了一个简单而强大的方式来管理应用的状态，核心特性包括：

-   极简的 API，易于上手。
-   通过 `state`、`getters` 和 `actions` 直观地组织 store。
-   `getters` 自动缓存，仅在依赖变化时重新计算。
-   支持跨 store 调用，实现复杂状态组合。
-   可选的内置持久化，可将状态自动同步到 `localStorage`。
-   提供 `debug` 模式，方便追踪状态变化。

---

## 目录

1.  [安装与引入](#1-安装与引入)
2.  [核心概念](#2-核心概念)
3.  [第一步：创建 Store](#3-第一步创建-store)
    -   [定义 State](#定义-state)
    -   [定义 Getters](#定义-getters)
    -   [定义 Actions](#定义-actions)
4.  [第二步：在组件中使用](#4-第二步在组件中使用)
5.  [API 详解](#5-api-详解)
    -   [Store 实例属性](#store-实例属性)
    -   [`$state`](#-state-)
    -   [`$patch()`](#-patch-)
    -   [`$reset()`](#-reset-)
    -   [`$subscribe()`](#-subscribe-)
6.  [高级用法](#6-高级用法)
    -   [Store 之间的通信](#store-之间的通信)
    -   [状态持久化](#状态持久化)
    -   [调试模式](#调试模式)
    -   [在组件外部使用 Store](#在组件外部使用-store)

---

## 1. 安装与引入

FCStore 是项目内的本地模块，你只需要从 `FCStore/index.ts` 引入 `defineStore` 函数即可开始使用。

```typescript
import { defineStore } from "../FCStore";
```

## 2. 核心概念

-   **Store**: 一个 Store 是一个“仓库”，它包含了应用的全局状态和操作这些状态的方法。每个 Store 都是一个独立的模块。
-   **`defineStore`**: 这是创建 Store 的核心函数。它接受一个唯一的 ID 和一个包含 `state`、`getters`、`actions` 的选项对象。
-   **`useStore`**: `defineStore` 函数的返回值是一个可以在 React 组件中使用的 Hook。调用这个 Hook 可以让你访问 Store 的实例。

## 3. 第一步：创建 Store

创建一个 Store 非常简单。我们以一个计数器为例：

```typescript
// src/stores/counterStore.ts
import { defineStore } from "../FCStore";

export const useCounterStore = defineStore("counter", {
	// 1. 定义 State
	state: () => ({
		count: 0,
		userName: "Alice",
	}),

	// 2. 定义 Getters
	getters: {
		doubledCount(): number {
			// Getters 会被缓存
			console.log("doubledCount is computing...");
			return this.count * 2;
		},
		greeting(): string {
			// 可以访问其他 state 和 getters
			return `Hello, ${this.userName}! Double count is ${this.doubledCount}.`;
		},
	},

	// 3. 定义 Actions
	actions: {
		increment() {
			this.count++;
		},
		incrementBy(amount: number) {
			this.count += amount;
		},
		async waitAndIncrement() {
			await new Promise((r) => setTimeout(r, 1000));
			this.count++;
		},
	},
});
```

### 定义 State

-   `state` 必须是一个返回对象的**函数**，这确保了每个 Store 实例都有一个独立的状态。
-   这是你的 Store 中唯一的数据源。

### 定义 Getters

-   `getters` 用于定义计算属性，它们可以根据 `state` 派生出新的值。
-   **自动缓存**：一个 getter 的值会被缓存起来，只有当它依赖的 `state` 发生变化时，才会重新计算。
-   在 getter 内部，你可以通过 `this` 访问 `state` 和其他 `getters`。

### 定义 Actions

-   `actions` 用于定义可以修改 `state` 的业务逻辑。
-   它们可以是同步的，也可以是**异步的** (`async/await`)。
-   在 action 内部，你可以通过 `this` 自由地读写 `state`，以及调用其他 `getters` 和 `actions`。

## 4. 第二步：在组件中使用

在 React 组件中，直接调用 `defineStore` 返回的 Hook 即可获取 Store 实例。

```tsx
// src/components/CounterComponent.tsx
import { useCounterStore } from "../stores/counterStore";

export function CounterComponent() {
	// 调用 hook 获取 store 实例
	const counterStore = useCounterStore();

	return (
		<div>
			<h1>Counter Demo</h1>

			{/* 1. 读取 state 和 getters */}
			<p>User: {counterStore.userName}</p>
			<p>Count: {counterStore.count}</p>
			<p>Doubled Count (Getter): {counterStore.doubledCount}</p>
			<p>Greeting (Getter): {counterStore.greeting}</p>

			{/* 2. 调用 actions */}
			<button onClick={() => counterStore.increment()}>Increment</button>
			<button onClick={() => counterStore.incrementBy(5)}>Increment by 5</button>
			<button onClick={() => counterStore.waitAndIncrement()}>Wait and Increment</button>

			{/* 3. 直接修改 state (同样有效) */}
			<button onClick={() => counterStore.count--}>Decrement Directly</button>
		</div>
	);
}
```

FCStore 会自动处理响应式更新。当 `state` 改变时，你的组件会自动重新渲染。

## 5. API 详解

### Store 实例属性

当你获取一个 Store 实例后，除了 `state`、`getters` 和 `actions`，还可以访问一些内置的工具属性和方法。

> **⚠️ 重要提示：关于修改嵌套对象**
> 
> 当前版本的 FCStore **不支持**直接修改对象内部的嵌套属性来触发响应式更新。例如，如果你的 state 是 `{ user: { name: 'Alice' } }`，执行 `store.user.name = 'Bob'` 将**不会**让组件刷新。
> 
> 为了确保响应式系统能够检测到变化，你必须替换整个对象。
> 
> ```typescript
> const store = useUserStore();
> 
> // ❌ 错误：这样操作不会触发组件更新！
> store.user.name = 'Bob';
> 
> // ✅ 正确：替换整个 user 对象
> store.user = { ...store.user, name: 'Bob' };
> 
> // ✅ 推荐：使用 action 或 $patch 方法来封装逻辑
> store.$patch({ user: { ...store.user, name: 'Bob' } });
> ```

### `$state`

直接访问 Store 的响应式 `state` 对象。

```typescript
const counterStore = useCounterStore.get();

// 访问
console.log(counterStore.$state.count);

// 替换整个 state (不推荐，通常使用 $patch 或 action)
counterStore.$state = { count: 100, userName: "Bob" };
```

### `$patch()`

用于同时修改多个 `state` 属性。这比多次单独修改性能更好，因为它只会触发一次更新。

```typescript
counterStore.$patch({
	count: counterStore.count + 10,
	userName: "Bob",
});
```

### `$reset()`

将 Store 的状态重置为 `state` 函数定义的初始值。

```typescript
counterStore.$reset();
```

### `$subscribe()`

在组件外部订阅 `state` 的变化。它接收一个回调函数，并返回一个 `unsubscribe` 函数。

```typescript
const unsubscribe = counterStore.$subscribe((state, changes) => {
	console.log("State changed!");
	console.log("New state:", state);
	console.log("Changes:", changes); // 仅包含被修改的属性
});

// 当你不再需要监听时
unsubscribe();
```

## 6. 高级用法

### Store 之间的通信

一个 Store 的 getter 或 action 可以依赖另一个 Store。**正确的方式**是在 getter 或 action **内部**通过 `.get()` 方法获取另一个 Store 的实例。

**错误示范**：不要在 `state` 中持有另一个 store 的实例，这会破坏响应式。

**正确示例**：

假设我们有一个 `userStore`，它的 `greeting` getter 需要用到 `counterStore` 的 `doubledCount`。

```typescript
// src/stores/userStore.ts
import { defineStore } from "../FCStore";
import { useCounterStore } from "./counterStore"; // 引入另一个 store

export const useUserStore = defineStore("user", {
	state: () => ({
		user: { name: "Charlie" },
	}),
	getters: {
		greeting(): string {
			// 在 getter 内部动态获取 counterStore 实例
			const counterStore = useCounterStore.get();

			// 现在可以安全地访问 counterStore 的 state 和 getters
			return `Hello, ${this.user.name}! The doubled count from another store is ${counterStore.doubledCount}.`;
		},
	},
});
```

### 状态持久化

FCStore 提供了一个简单的持久化插件，可以将 Store 的状态自动保存到 Web Storage (默认为 `localStorage`)。

#### 简单用法

只需在 `defineStore` 时添加 `persist: true`。

```typescript
export const useCounterStore = defineStore("counter", {
	state: () => ({ count: 0 }),
	// ...
	persist: true, // 开启持久化
});
```

现在，`counter` Store 的状态会在每次变更后自动保存到 `localStorage`，并在页面刷新时恢复。

#### 高级配置

你也可以提供一个对象来自定义持久化行为。

```typescript
export const useUserStore = defineStore("user", {
	state: () => ({ user: { name: "Guest" } }),
	// ...
	persist: {
		enabled: true,
		storage: sessionStorage, // 使用 sessionStorage
		prefix: "my-app-", // 自定义存储前缀
	},
});
```

### 调试模式

开启 `debug: true` 后，每一次 `action` 的调用或 `$patch` 的执行都会在控制台打印出详细的日志，包括调用前的状态、参数以及调用后的状态，方便你追踪每一次状态变化。

```typescript
export const useCounterStore = defineStore("counter", {
	state: () => ({ count: 0 }),
	actions: {
		increment() {
			this.count++;
		},
	},
	debug: true, // 开启调试模式
});
```

### 在组件外部使用 Store

你可以使用 `useStore.get()` 方法在任何地方（例如，在另一个工具函数或模块中）获取 Store 的实例。

```typescript
// src/utils/api.ts
import { useUserStore } from "../stores/userStore";

export function getUserData() {
	const userStore = useUserStore.get(); // 获取 store 实例
	const currentUserName = userStore.user.name;

	console.log(`Fetching data for ${currentUserName}...`);
	// ... fetch logic
}
```