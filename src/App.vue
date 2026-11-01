<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import TorrentDataView from '@/components/TorrentDataView.vue'
import { useMainStore } from '@/stores/mainStore'
import { Torrent, Torrent_format } from '@/torrent'
import { copy_to_clipboard } from '@/utils'

const is_show_about = ref<boolean>(false)
const home_link = 'https://github.com/op200/torrent-parser'

const mainStore = useMainStore()
const { torrent_list, is_dirty } = storeToRefs(mainStore)

const current_torrent_list_index = ref<number>(0)
const current_torrent = computed<Torrent | undefined>(
  () => torrent_list.value[current_torrent_list_index.value],
)

// 哈希是异步算出来的（Web Crypto），单独放在 ref 里给模板用
const current_hash_v1 = ref<string>('')
const current_hash_v2 = ref<string>('')

// 每次重新计算递增，用于丢弃已经过期的结果
let hash_request_id = 0

watch(
  current_torrent,
  async (torrent) => {
    const request_id = ++hash_request_id

    if (torrent === undefined) {
      current_hash_v1.value = ''
      current_hash_v2.value = ''
      return
    }

    const [hash_v1, hash_v2] = await Promise.all([torrent.get_hash_v1(), torrent.get_hash_v2()])

    // 算的过程中又切了 torrent、或又改了内容，本次结果作废
    if (request_id !== hash_request_id) return

    current_hash_v1.value = hash_v1
    current_hash_v2.value = hash_v2
  },
  { deep: true, immediate: true },
)

async function copy_all_magnet() {
  const magnet_list = await Promise.all(
    torrent_list.value.map((torrent) => torrent.generate_magnet()),
  )

  await copy_to_clipboard(magnet_list.join('\n'))
}

async function copy_current_magnet() {
  await copy_to_clipboard(await current_torrent.value?.generate_magnet())
}

async function add_torrents() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.torrent'
  input.multiple = true

  input.onchange = async (event: Event) => {
    const target = event.target as HTMLInputElement

    const files = target.files

    if (files === null || files.length === 0) {
      console.error('input torrent -> ', files)
      return
    }

    for (const file of Array.from(files))
      torrent_list.value.push(new Torrent(await file.arrayBuffer(), file.name))

    current_torrent_list_index.value = torrent_list.value.length - 1
  }

  input.click()
}

function save_torrent(torrent: Torrent | undefined) {
  if (torrent === undefined) {
    console.error(
      'current torrent obj is null',
      torrent_list.value[current_torrent_list_index.value],
    )
    return
  }

  const buffer = torrent.encode()

  // 保存为torrent文件作为浏览器下载器导出
  const blob = new Blob([Uint8Array.from(buffer)], { type: 'application/x-bittorrent' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = torrent.filename || 'download.torrent'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function fake_hybrid_as_v1(torrent: Torrent | undefined): Torrent {
  if (torrent === undefined) throw new Error('The input file is undefined')

  const v1_torrent = new Torrent(torrent.encode(), `fake_as_v1-${torrent.filename}`)

  delete v1_torrent.data['piece layers']
  delete v1_torrent.data.info['meta version']
  delete v1_torrent.data.info['file tree']

  return v1_torrent
}

function is_hybrid(torrent: Torrent | undefined): boolean {
  return torrent?.get_format() === Torrent_format.hybrid
}

function remove_piece_layers(torrent: Torrent | undefined): Torrent {
  if (torrent === undefined) throw new Error('The input file is undefined')

  const new_torrent = new Torrent(torrent.encode(), `remove_piece_layers-${torrent.filename}`)

  delete new_torrent.data['piece layers']

  return new_torrent
}
</script>

<template>
  <div style="display: grid; gap: 1rem">
    <!-- 按钮栏 -->
    <div class="flex-line">
      <button @click="add_torrents">Add torrent</button>

      <button @click="console.info(torrent_list)">Print list</button>

      <button @click="((torrent_list.length = 0), (current_torrent_list_index = 0))">
        Clear list
      </button>

      <button
        @click="
          (() => {
            torrent_list.splice(current_torrent_list_index, 1)
            current_torrent_list_index = Math.max(0, current_torrent_list_index - 1)
          })()
        "
        :disabled="!torrent_list.length"
      >
        Delete current
      </button>

      <button @click="copy_all_magnet" :disabled="!torrent_list.length">Copy all magnet</button>

      <button @click="is_show_about = !is_show_about">About</button>
    </div>

    <!-- About -->
    <div v-show="is_show_about">
      <h2>About</h2>
      <a :href="home_link" target="_blank">{{ home_link }}</a>
      <p>
        Why need the 'Remove piece layers': The 'bencode' has a bug in decoding piece layers, if the
        'piece layers' are not removed, the output torrent file format is illegal
      </p>
    </div>

    <!-- 内容展示 -->
    <div
      style="border: 1px solid lightgray; padding: 1rem; display: grid; gap: 1rem"
      v-show="torrent_list.length > 0"
    >
      <!-- 页标 -->
      <div class="flex-line">
        <button
          v-for="(torrent, i) in torrent_list"
          :key="i"
          @click="current_torrent_list_index = i"
          :class="{
            selected: i === current_torrent_list_index,
            'torrent-tab--changed': mainStore.is_torrent_changed(torrent),
          }"
        >
          {{ i + 1 }}. {{ torrent.filename }}
        </button>
      </div>

      <!-- 解析信息 -->
      <div style="display: grid; gap: 0.5rem">
        <div>{{ torrent_list[current_torrent_list_index]?.filename }}</div>

        <div>{{ torrent_list[current_torrent_list_index]?.get_format().toString() }}</div>

        <div v-show="current_hash_v1">Info Hash v1: {{ current_hash_v1 }}</div>

        <div v-show="current_hash_v2">Info Hash v2: {{ current_hash_v2 }}</div>
      </div>

      <!-- buttons -->
      <div style="display: flex; gap: 1rem">
        <button @click="copy_current_magnet">Copy magnet</button>

        <button @click="save_torrent(torrent_list[current_torrent_list_index])">
          Save torrent
        </button>

        <button
          v-if="false"
          :disabled="!is_hybrid(torrent_list[current_torrent_list_index])"
          @click="torrent_list.push(fake_hybrid_as_v1(torrent_list[current_torrent_list_index]))"
        >
          Fake hybrid → v1
        </button>

        <button
          :disabled="
            (() => {
              const data = torrent_list[current_torrent_list_index]?.data
              if (data) return !('piece layers' in data)
              return true
            })()
          "
          @click="torrent_list.push(remove_piece_layers(torrent_list[current_torrent_list_index]))"
        >
          Remove piece layers
        </button>

        <!-- 改动只在点这个按钮时写进 localStorage -->
        <button :disabled="!is_dirty" @click="mainStore.save_changes()">Save changes</button>
      </div>

      <!-- 内容 -->
      <div class="content-box">
        <TorrentDataView
          v-if="torrent_list.length > 0"
          :path="[current_torrent_list_index, 'data']"
        />
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

/* 有未保存改动的种子：按钮换成琥珀色，和预览区里的改动高亮对上 */
.torrent-tab--changed {
  background-color: var(--changed-solid);
}

.torrent-tab--changed:hover {
  background-color: var(--changed-solid-hover);
}

.torrent-tab--changed.selected {
  box-shadow:
    0 0 0 2px var(--ring-gap),
    0 0 0 4px var(--changed-solid);
}
</style>
