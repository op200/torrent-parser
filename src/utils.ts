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

/**
 * 复制文本到剪贴板
 * @param text 要复制的字符串
 * @returns Promise<boolean> 是否成功
 */
export async function copy_to_clipboard(text: string | undefined): Promise<boolean> {
    if (text === undefined)
        return false

    try {
        // 使用现代 Clipboard API
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('复制失败:', err);
        return fallback_copy(text); // 降级方案
    }
}

// 降级方案（兼容旧浏览器）
function fallback_copy(text: string): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed'; // 避免滚动
    document.body.appendChild(textarea);
    textarea.select();

    try {
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    } catch (err) {
        console.error('降级复制失败:', err);
        document.body.removeChild(textarea);
        return false;
    }
}