<script setup lang="ts">
import RecursiveComponent from "@/components/RecursiveComponent.vue"

import Torrent from "@/torrent"

import { ref } from "vue"
import { storeToRefs } from 'pinia'


import { useMainStore } from '@/stores/mainStore'
import { buffer } from "stream/consumers"
const mainStore = useMainStore();
const { torrent_list } = storeToRefs(mainStore)

const current_torrent_list_index = ref<number>(0)

async function add_torrents(event: Event): Promise<boolean> {
  const target = event.target as HTMLInputElement

  const files = target.files

  if (files === null || files.length === 0) {
    console.error("input torrent -> ", files)
    return false
  }

  for (const file of files)
    torrent_list.value.push(new Torrent(await file.arrayBuffer(), file.name))

  current_torrent_list_index.value = torrent_list.value.length - 1

  return true
}

function save_torrent(torrent: Torrent | undefined) {
  if (torrent === undefined) {
    console.error('current torrent obj is null',
      torrent_list.value[current_torrent_list_index.value])
    return
  }

  const buffer = torrent.encode()

  // 保存为torrent文件作为浏览器下载器导出
  const blob = new Blob([Uint8Array.from(buffer)], { type: 'application/x-bittorrent' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = torrent.filename || "download.torrent";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fake_hybrid_as_v1(torrent: Torrent | undefined): Torrent | undefined {
  if (torrent === undefined) {
    console.error('The input file is undefined')
    return undefined
  }

  const v1_torrent = new Torrent(torrent.encode(), `${torrent.filename}-fake_as_v1`)

  // TODO

  return v1_torrent
}

</script>

<template>
  <!-- 按钮栏 -->
  <div class="flex-line">
    <input type="file" multiple @change="add_torrents" accept=".torrent" />

    <button @click="console.info(torrent_list)">Print list</button>
    <button @click="torrent_list.length = 0, current_torrent_list_index = 0">Clear list</button>

    <button @click="save_torrent(torrent_list[current_torrent_list_index])" v-show="torrent_list.length > 0">Save
      torrent</button>
    <!-- <button @click="save_torrent(fake_hybrid_as_v1(torrent_list[current_torrent_list_index]))"
      v-show="torrent_list.length > 0">Fake&Save hybrid → v1</button> -->
  </div>

  <br>

  <!-- 内容展示 -->
  <div style="border: 1px solid lightgray;padding: 1rem;display: grid;gap: 0.2rem;">
    <!-- 页标 -->
    <div class="flex-line">
      <button v-for="torrent, i in torrent_list" @click="current_torrent_list_index = i"
        :class="i === current_torrent_list_index ? 'selected' : ''">
        {{ i + 1 }}. {{ torrent.filename }}
      </button>
    </div>

    <p>{{ torrent_list[current_torrent_list_index]?.filename }}</p>

    <!-- 内容 -->
    <div class="content-box">
      <RecursiveComponent v-if="torrent_list.length > 0" :path="[current_torrent_list_index, 'data']" />
    </div>
  </div>
</template>

<style scoped>
.flex-line {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  /* padding: 0.4rem 1rem; */
}

.content-box {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.content-key {
  border: 1px solid cornflowerblue;
}

.content-val {
  border: 1px solid rosybrown;
}
</style>
