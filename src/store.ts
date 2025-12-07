import { defineStore } from "./FCStore";

const useCounterStore = defineStore("counter", {
	state: () => ({
		count: 10,
		obj: { abc: "" } as Record<string, string>,
		array: [] as string[],
	}),
	actions: {
		setCount(_count: number) {
			this.count = _count;
		},
		increment() {
			this.count++;
		},
		change() {
			// this.array = ['1', '2', '3'];
			this.array.push("1");
			this.obj.abc = "abc";
			this.$subscribe((state) => {
				console.log("订阅", state);
			});
		},
		asyncMethod() {
			return new Promise<number>((res) => {
				setTimeout(() => {
					console.log("异步this", this);
					this.count++;
					// 手动调用$patch来确保异步操作后UI更新
					// this.$patch({ count: this.count });

					res(this.count);
				}, 1000);
			});
		},
		async asyncMethod2() {
			const a = await this.asyncMethod();
			console.log(a);
			return a;
		},
	},

	// 启用持久化功能
	persist: false,
});
export default useCounterStore;
