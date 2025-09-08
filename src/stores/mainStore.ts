import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { Buffer } from 'buffer'

import { localStore as local_store } from '@/utils'
import { Torrent } from "@/torrent"

type Torrent_data = {
  filename: string
  buffer_str: string
}

export const useMainStore = defineStore('mainStore', () => {

  const torrent_data_list = ref<Torrent_data[]>([])
  local_store.set_store(torrent_data_list, "torrent_buffer_list")

  const torrent_list = ref<Torrent[]>(torrent_data_list.value.map(d =>
    new Torrent(Buffer.from(d.buffer_str, 'base64'), d.filename)
  ))
  watch(torrent_list, () => {
    torrent_data_list.value = torrent_list.value.map(t => {
      return { filename: t.filename, buffer_str: Buffer.from(t.encode()).toString('base64') } as Torrent_data
    })
  }, { deep: true })

  return { torrent_list }

})
