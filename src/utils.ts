import { watch, type Ref } from 'vue'

export namespace localStore {
    export function set_store(refVar: Ref<any>, name: string) {
        name = "torrent-parser_" + name
        const jsonStr = localStorage.getItem(name)
        if (jsonStr) {
            const tempVar: any = JSON.parse(jsonStr)
            refVar.value = tempVar
        }
        watch(refVar,
            () => {
                localStorage.setItem(name, JSON.stringify(refVar.value))
            },
            { deep: true })
    }
}