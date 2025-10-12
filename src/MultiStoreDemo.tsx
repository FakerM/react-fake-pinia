import { useCounterStore } from "./stores/counterStore";
import { useUserStore } from "./stores/userStore";

export function MultiStoreDemo() {
	const counterStore = useCounterStore();
	const userStore = useUserStore();

	console.log("--- Component is rendering ---");

	return (
		<div style={{ fontFamily: "sans-serif", padding: "20px", maxWidth: "800px", margin: "auto" }}>
			<h1>Multi-Store & Getter Cache Demo</h1>

			{/* Counter Store Section */}
			<div style={{ background: "#f0f4f8", padding: "15px", borderRadius: "5px", marginBottom: "20px" }}>
				<h2>Counter Store</h2>
				<p>
					<b>Count:</b> {counterStore.count}
				</p>
				<p>
					<b>Doubled Count (Getter):</b> {counterStore.doubledCount}
				</p>
				<button onClick={() => counterStore.increment()}>Increment Count</button>
			</div>

			{/* User Store Section */}
			<div style={{ background: "#fef6e6", padding: "15px", borderRadius: "5px" }}>
				<h2>User Store</h2>
				<p>
					<b>User Name:</b> {userStore.user.name}
				</p>
				<p>
					<b>Greeting (Cross-Store Getter):</b> {userStore.greeting}
				</p>
				<button onClick={() => userStore.changeName(userStore.user.name === "Alice" ? "Bob" : "Alice")}>Change User Name</button>
			</div>

			<h2 style={{ marginTop: "30px" }}>验证步骤</h2>
			<ol>
				<li>
					<b>初始化:</b> 页面加载时，控制台应该打印一次 "✨ doubledCount is computing..." 和一次 "🚀 greeting is computing..."。
				</li>
				<li>
					<b>点击 "Change User Name":</b>
					<ul>
						<li>
							✅ <b>预期：</b>只有 "🚀 greeting is computing..." 会被打印。
						</li>
						<li>
							❌ <b>非预期：</b>"✨ doubledCount" 不应该被打印，因为它依赖的 `count` 没变，缓存生效。
						</li>
					</ul>
				</li>
				<li>
					<b>点击 "Increment Count":</b>
					<ul>
						<li>
							✅ <b>预期：</b>"✨ doubledCount is computing..." 会先被打印，因为它被失效了。
						</li>
						<li>
							✅ <b>预期：</b>随后 "🚀 greeting is computing..." 也会被打印，因为它依赖 `doubledCount`，`doubledCount` 的改变导致了它的重新计算。
						</li>
						<li>这证明了跨 store 的响应式依赖和缓存失效链条是通的。</li>
					</ul>
				</li>
				<li>
					<b>再次点击 "Change User Name":</b> 结果应该和第 2 步一样，证明缓存系统在多次更新后依然正常工作。
				</li>
			</ol>
		</div>
	);
}
