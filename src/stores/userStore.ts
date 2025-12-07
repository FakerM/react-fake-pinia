import { defineStore } from "../FCStore";
import { useCounterStore } from "./counterStore";

export const useUserStore = defineStore("user", {
	state: () => ({
		user: { name: "Alice" },
		log: null,
		obj: { a: "a", b: { c: "c" } },
	}),
	actions: {
		getGreeting(): string {
			const counterStore = useCounterStore.get();
			// 在 getter 内部调用另一个 store
			// 这个 getter 同时依赖了自身的 state 和另一个 store 的 getter
			return `Hello, ${this.user.name}! The doubled count is ${counterStore.getDoubledCount() * 2}. ${this.getName()}`;
		},
		getName() {
			return this.user.name;
		},
		changeName(newName: string) {
			this.$patch({ user: { name: newName } });
		},
		getData() {
			return new Promise((resolve) => {
				setTimeout(() => {
					resolve("data");
				}, 1000);
			});
		},
	},
});
