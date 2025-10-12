import { defineStore } from "../FCStore";

export const useCounterStore = defineStore("counter", {
	debug: true,
	state: () => ({
		count: 0,
	}),
	getters: {
		doubledCount(): number {
			console.log("%c ✨ counterStore: doubledCount is computing... ", "color: white; background-color: #f5a623; padding: 2px 4px; border-radius: 3px;");
			return this.count * 2;
		},
	},
	actions: {
		consoleGetter() {
			console.log(this.doubledCount);
		},
		increment() {
			this.count++;
		},
	},
});
