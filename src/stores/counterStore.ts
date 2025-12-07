import { defineStore } from "../FCStore";

export const useCounterStore = defineStore("counter", {
	state: () => ({
		count: 0,
	}),
	actions: {
		getDoubledCount(): number {
			return this.count * 2;
		},
		getReDoubleCount() {
			return this.getDoubledCount() * 2;
		},
		consoleGetter() {
			console.log(this.getDoubledCount());
		},
		increment() {
			this.count++;
		},
	},
});
