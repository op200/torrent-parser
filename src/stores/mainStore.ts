import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

import { localStore as local_store } from '@/utils'
import Torrent from "@/torrent"

export const useMainStore = defineStore('mainStore', () => {

  const torrent_list = ref<Torrent[]>([])
  local_store.set_store(torrent_list, "torrent_list")

  return { torrent_list }

})
