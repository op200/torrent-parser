import { Buffer } from 'buffer'
import bencode from 'bencode'
import CryptoJS from "crypto-js"

type Primitive = string | number | boolean | null
type BencodeValue = Primitive | BencodeValue[] | { [key: string]: BencodeValue }
type Converted<T> = T extends Uint8Array
    ? string
    : T extends object
    ? { [K in keyof T]: Converted<T[K]> }
    : T

function convert_uint8_arrays<T>(obj: T): Converted<T> {
    // 处理 Uint8Array
    if (obj instanceof Uint8Array) {
        return new TextDecoder('utf-8').decode(obj) as Converted<T>
    }

    // 处理数组
    if (Array.isArray(obj)) {
        return obj.map(convert_uint8_arrays) as Converted<T>
    }

    // 处理普通对象
    if (obj && typeof obj === 'object') {
        const result: Record<string, any> = {}
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key))
                if (new Set(['pieces', 'pieces root']).has(key) || key.length >= 32)
                    result[key] = obj[key]
                else
                    result[key] = convert_uint8_arrays(obj[key])
        }
        return result as Converted<T>
    }

    // 基本类型直接返回
    return obj as Converted<T>
}

function buffer_to_word_array(buffer: Buffer): CryptoJS.lib.WordArray {
    // 使用 CryptoJS 的 Latin1 解析器直接处理字节数据
    return CryptoJS.enc.Latin1.parse(buffer.toString('latin1'));
}

export enum Torrent_format {
    v1 = 'BT v1',
    v2 = 'BT v2',
    hybrid = 'BT v2-Hybrid',
}

export class Torrent {
    filename: string
    data

    constructor(buffer: ArrayBuffer | Buffer, filename: string = "") {
        this.filename = filename

        if (buffer instanceof ArrayBuffer)
            this.data = convert_uint8_arrays(
                bencode.decode(Buffer.from(buffer))
            )
        else
            this.data = convert_uint8_arrays(
                bencode.decode(buffer)
            )

        // if (this.get_format() !== Torrent_format.v1)
        //     this.data.info["pieces"] = []

    }

    get_format(): Torrent_format {
        if (this.data.info["meta version"] === 2)
            if ("files" in this.data.info)
                return Torrent_format.hybrid
            else return Torrent_format.v2
        return Torrent_format.v1
    }


    get_hash_v1(): string {
        if (this.get_format() === Torrent_format.v2)
            return ""

        const encodedInfo = bencode.encode(this.data.info)
        const buffer = Buffer.from(encodedInfo)
        const wordArray = buffer_to_word_array(buffer)
        const sha1Hash = CryptoJS.SHA1(wordArray)
        return sha1Hash.toString(CryptoJS.enc.Hex)
    }

    get_hash_v2(): string {
        if (this.get_format() === Torrent_format.v1)
            return ""

        const encodedInfo = bencode.encode(this.data.info)
        const buffer = Buffer.from(encodedInfo)
        const wordArray = buffer_to_word_array(buffer)
        const sha256Hash = CryptoJS.SHA256(wordArray)
        return sha256Hash.toString(CryptoJS.enc.Hex)
    }

    encode(): Buffer<ArrayBufferLike> {
        return bencode.encode(this.data)
    }


    generate_magnet(): string {
        const magnet_str_list = Array<string>()

        switch (this.get_format()) {
            case Torrent_format.v1:
                magnet_str_list.push('xt=urn:btih:' + this.get_hash_v1())
                break
            case Torrent_format.v2:
                magnet_str_list.push('xt=urn:btmh:1220' + this.get_hash_v2())
                break
            case Torrent_format.hybrid:
                magnet_str_list.push('xt=urn:btih:' + this.get_hash_v1())
                magnet_str_list.push('xt=urn:btmh:1220' + this.get_hash_v2())
                break
        }

        return "magnet:?" + magnet_str_list.join('&')
    }
}
