import { defineEventHandler, toWebRequest } from 'h3'
import handler from 'vidact-start-handler'

export default defineEventHandler((event) => handler(toWebRequest(event)))
