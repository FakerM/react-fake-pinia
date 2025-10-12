import { defineStore } from "../FCStore";
import { useCounterStore } from "./counterStore";

export const useUserStore = defineStore("user", {
	debug: true,
	state: () => ({
		user: { name: "Alice" },
		log: null,
	}),
	getters: {
		greeting(): string {
			const counterStore = useCounterStore.get();
			// 在 getter 内部调用另一个 store
			console.log("%c 🚀 userStore: greeting is computing... ", "color: white; background-color: #7ed321; padding: 2px 4px; border-radius: 3px;");

			// 这个 getter 同时依赖了自身的 state 和另一个 store 的 getter
			return `Hello, ${this.user.name}! The doubled count is ${counterStore.doubledCount}.`;
		},
	},
	actions: {
		changeName(newName: string) {
			// 使用 $patch 方法来更新 state。这对于更新多个属性或意图更明确的场景非常有用。
			this.$patch({
				user: { ...this.user, name: newName },
			});
		},
	},
});
