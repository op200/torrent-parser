<script setup lang="ts">
import { ref, computed } from 'vue';
import type { PropType } from 'vue';
import { useMainStore } from '@/stores/mainStore';

// 定义类型
type NestedData = Record<string, any> | any[];

// Props 定义
const props = defineProps({
    path: {
        type: Array as PropType<Array<string | number>>,
        required: true,
    },
});

const mainStore = useMainStore();
const { torrent_list } = mainStore;

// 折叠状态管理
const expandedKeys = ref(new Set<string>());
const MAX_DISPLAY_LENGTH = 200;

// 判断是否是嵌套结构
const isNested = (val: unknown): val is NestedData => {
    return val !== null && typeof val === 'object';
};

// 计算背景色（基于路径深度）
const backgroundColor = computed(() => {
    const depth = props.path.length;
    const opacity = 0.1 + Math.min(depth * 0.1, 0.5);
    return `rgba(100, 150, 255, ${opacity})`;
});

// 获取当前路径对应的值
const currentValue = computed({
    get(): any {
        return props.path.reduce((obj: any, key) => obj[key], torrent_list);
    },
    set(newValue: any) {
        // 更新store中的数据
        const path = [...props.path];
        const lastKey = path.pop();
        const parent = path.reduce((obj: any, key) => obj[key], torrent_list);
        if (parent && lastKey !== undefined) {
            parent[lastKey] = newValue;
        }
    }
});

// 切换折叠状态
const toggleExpand = (key: string) => {
    if (expandedKeys.value.has(key)) {
        expandedKeys.value.delete(key);
    } else {
        expandedKeys.value.add(key);
    }
};

// 处理数组索引显示
const displayKey = (key: string | number) => {
    return typeof key === 'number' ? `[${key}]` : key;
};
</script>

<template>
    <div class="content-block" :style="{ backgroundColor }">
        <!-- 遍历对象或数组 -->
        <template v-if="isNested(currentValue)">
            <div v-for="(value, key) in currentValue" :key="key" class="content-line">
                <!-- 基本类型（非对象/数组） -->
                <template v-if="!isNested(value)">
                    <div class="content-simple">
                        <span class="content-key">{{ displayKey(key) }}:</span>
                        <input type="text" class="content-input" :value="value"
                            @input="currentValue[key] = ($event.target as HTMLInputElement).value" />
                    </div>
                </template>

                <!-- 嵌套对象或数组（递归调用） -->
                <template v-else>
                    <div class="nested-header" @click="toggleExpand(String(key))">
                        <span class="content-key">{{ displayKey(key) }}:</span>
                        <span class="toggle-icon">
                            {{ expandedKeys.has(String(key)) ? '▼' : '▶' }}
                        </span>
                    </div>
                    <div v-if="expandedKeys.has(String(key))" class="nested-content">
                        <RecursiveComponent :path="[...props.path, key]" />
                    </div>
                </template>
            </div>
        </template>

        <!-- 处理非嵌套值（直接显示输入框） -->
        <div v-else class="content-simple">
            <input type="text" class="content-input" :value="currentValue"
                @input="currentValue = ($event.target as HTMLInputElement).value" />
        </div>
    </div>
</template>

<style scoped>
.content-block {
    padding: 0.4rem;
    border-radius: 4px;
}

.content-line {
    margin-bottom: 0.3rem;
}

.content-simple {
    display: flex;
    align-items: center;
    gap: 5px;
}

.content-key {
    font-weight: bold;
    min-width: max-content;
}

.content-input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid #ddd;
    border-radius: 3px;
    font-family: inherit;
    font-size: inherit;
}

.content-input:focus {
    outline: none;
    background-color: #e8e8e8;
}

.nested-header {
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: 2px 0;
}

.nested-header:hover {
    background-color: rgba(0, 0, 0, 0.05);
    border-radius: 5px;
}

.toggle-icon {
    margin-left: 5px;
    font-size: 0.8em;
    min-width: 1em;
}

.nested-content {
    margin-left: 0.2rem;
    border-left: 1px dashed #ccc;
    padding-left: 0.5rem;
}
</style>