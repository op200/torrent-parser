<script setup lang="ts">
import RecursiveComponent from "@/components/RecursiveComponent.vue"

import { Torrent, Torrent_format } from "@/torrent"

import { ref } from "vue"
import { storeToRefs } from 'pinia'
import { Buffer } from 'buffer'

import { useMainStore } from '@/stores/mainStore'
import { copy_to_clipboard } from '@/utils'
import { error } from "console"

const is_show_about = ref<boolean>(false)
const home_link = "https://github.com/op200/torrent-parser"

const mainStore = useMainStore();
const { torrent_list } = storeToRefs(mainStore)

const current_torrent_list_index = ref<number>(0)

async function add_torrents() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.torrent'
  input.multiple = true

  input.onchange = async (event: Event) => {

    const target = event.target as HTMLInputElement

    const files = target.files

    if (files === null || files.length === 0) {
      console.error("input torrent -> ", files)
      return
    }

    for (const file of files)
      torrent_list.value.push(new Torrent(await file.arrayBuffer(), file.name))

    current_torrent_list_index.value = torrent_list.value.length - 1
  }

  input.click()
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

function fake_hybrid_as_v1(torrent: Torrent | undefined): Torrent {
  if (torrent === undefined)
    throw new Error('The input file is undefined')

  const v1_torrent = new Torrent(torrent.encode(), `fake_as_v1-${torrent.filename}`)

  delete v1_torrent.data["piece layers"]
  delete v1_torrent.data.info["meta version"]
  delete v1_torrent.data.info["file tree"]

  return v1_torrent
}

function remove_piece_layers(torrent: Torrent | undefined): Torrent {
  if (torrent === undefined)
    throw new Error('The input file is undefined')

  const new_torrent = new Torrent(torrent.encode(), `remove_piece_layers-${torrent.filename}`)

  delete new_torrent.data["piece layers"]

  return new_torrent
}

</script>

<template>
  <div style="display: grid;gap: 1rem;">

    <!-- 按钮栏 -->
    <div class="flex-line">
      <button @click="add_torrents">Add torrent</button>

      <button @click="console.info(torrent_list)">Print list</button>
      <button @click="torrent_list.length = 0, current_torrent_list_index = 0">Clear list</button>

      <button @click="copy_to_clipboard(torrent_list
        .map(torrent => torrent.generate_magnet())
        .join('\n'))" :disabled="torrent_list.length < 1">Copy all magnet</button>

      <button @click="is_show_about = !is_show_about">About</button>
    </div>

    <!-- About -->
    <div v-show="is_show_about">
      <h2>About</h2>
      <a :href="home_link" target="_blank">{{ home_link }}</a>
      <p>Why need the 'Remove piece layers': The 'bencode' has a bug in decoding piece layers, if the 'piece layers' are
        not removed, the output torrent file format is illegal</p>
    </div>

    <!-- 内容展示 -->
    <div style="border: 1px solid lightgray;padding: 1rem;display: grid;gap: 1rem;" v-show="torrent_list.length > 0">
      <!-- 页标 -->
      <div class="flex-line">
        <button v-for="torrent, i in torrent_list" @click="current_torrent_list_index = i"
          :class="i === current_torrent_list_index ? 'selected' : ''">
          {{ i + 1 }}. {{ torrent.filename }}
        </button>
      </div>

      <!-- 解析信息 -->
      <div style="display: grid;gap: 0.5rem;">
        <div>{{ torrent_list[current_torrent_list_index]?.filename }}</div>

        <div>{{ torrent_list[current_torrent_list_index]?.get_format().toString() }}</div>

        <div v-show="torrent_list[current_torrent_list_index]?.get_hash_v1()">Info Hash v1: {{
          torrent_list[current_torrent_list_index]?.get_hash_v1() }}</div>

        <div v-show="torrent_list[current_torrent_list_index]?.get_hash_v2()">Info Hash v2: {{
          torrent_list[current_torrent_list_index]?.get_hash_v2() }}</div>
      </div>

      <!-- buttons -->
      <div style="display: flex;gap: 1rem;">
        <button @click="copy_to_clipboard(torrent_list[current_torrent_list_index]?.generate_magnet())">Copy
          magnet</button>

        <button @click="save_torrent(torrent_list[current_torrent_list_index])">Save
          torrent</button>

        <button v-if="false"
          :disabled="torrent_list[current_torrent_list_index]?.get_format() !== Torrent_format.hybrid"
          @click="torrent_list.push(fake_hybrid_as_v1(torrent_list[current_torrent_list_index]))">Fake
          hybrid → v1</button>

        <button :disabled="(() => {
          const data = torrent_list[current_torrent_list_index]?.data
          if (data)
            return !('piece layers' in data)
          return true
        })()" @click="torrent_list.push(remove_piece_layers(torrent_list[current_torrent_list_index]))">Remove piece
          layers</button>
      </div>

      <!-- 内容 -->
      <div class="content-box">
        <RecursiveComponent v-if="torrent_list.length > 0" :path="[current_torrent_list_index, 'data']" />
      </div>
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
