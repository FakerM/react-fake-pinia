import React from "react";
import useStore from "./store"

export interface StoreProps {
  store: ReturnType<typeof useStore>;
  ref: any
}

const withStore = (Component: React.ComponentType<StoreProps>) => {
  return React.forwardRef((props: Omit<any, keyof StoreProps>, ref: any) => {
    const store = useStore()
    return <Component {...props} ref={ref} store={store} />
  })
}

export default withStore