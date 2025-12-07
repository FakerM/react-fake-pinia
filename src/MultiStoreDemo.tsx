import { useEffect } from "react";
import { useCounterStore } from "./stores/counterStore";
import { useUserStore } from "./stores/userStore";

export function MultiStoreDemo() {
	const counterStore = useCounterStore();
	const userStore = useUserStore();

	useEffect(() => {
		const unsubscribe = userStore.$subscribe((state, prev, changed) => {
			console.log("state :%o, prev: %o, changed: %o", state, prev, changed);
		});
		return unsubscribe;
	}, [userStore]);
	useEffect(() => {
		setTimeout(() => {
			userStore.obj = { a: "abc", b: { c: "cba" } };
		}, 1000);
	}, [userStore]);

	return (
		<div style={{ fontFamily: "sans-serif", padding: "20px", maxWidth: "800px", margin: "auto" }}>
			<h1>Multi-Store Demo</h1>

			{/* Counter Store Section */}
			<div style={{ background: "#f0f4f8", padding: "15px", borderRadius: "5px", marginBottom: "20px" }}>
				<h2>Counter Store</h2>
				<p>
					Count: {counterStore.count} | Doubled: {counterStore.getDoubledCount()} | ReDoubled: {counterStore.getReDoubleCount()}
				</p>
				<button onClick={counterStore.increment}>Increment Count</button>
				<button onClick={counterStore.consoleGetter}>Console Getter</button>
			</div>

			{/* User Store Section */}
			<div style={{ marginTop: "20px", padding: "10px", border: "1px solid #ddd", borderRadius: "8px" }}>
				<h2>User Store</h2>
				<p>User: {userStore.user.name}</p>
				<p>
					Greeting (depends on Counter): <strong>{userStore.getGreeting()}</strong>
				</p>
				<button onClick={() => userStore.changeName(userStore.user.name === "Alice" ? "Bob" : "Alice")}>Change User Name</button>
				<button onClick={() => userStore.$reset()}>Reset User Store</button>
				<button onClick={() => userStore.getData().then((data) => console.log(data))}>异步操作</button>
			</div>

			<h2 style={{ marginTop: "30px" }}>验证步骤</h2>
			<ol>
				<li>
					<b>初始化:</b> 页面加载时，控制台应该打印 "✨ doubledCount..." 和 "🚀 greeting..."。
				</li>
				<li>
					<b>点击 "Change User Name":</b>
					<ul>
						<li>组件重渲染，访问 `greeting` 和 `doubledCount`。</li>
						<li>由于移除了缓存，Getter 会重新计算，控制台会再次打印日志。</li>
						<li>
							<b>设计理念：</b>这是一个微型库，为了保证跨 Store 数据的一致性并降低复杂度，我们移除了内部缓存。
							<br />
							如果遇到昂贵的计算，建议在组件中使用 <code>useMemo</code>。
						</li>
					</ul>
				</li>
				<li>
					<b>点击 "Increment Count":</b>
					<ul>
						<li>`counterStore` 更新 - 组件重渲染 - `greeting` 重新计算。</li>
						<li>因为是实时计算，`greeting` 能正确获取到最新的 `doubledCount`，UI 显示正确。</li>
					</ul>
				</li>
			</ol>
		</div>
	);
}
