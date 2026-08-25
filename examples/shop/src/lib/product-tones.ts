import type { ProductTone } from '../model.ts'

export const productToneClassNames = {
  cream: 'bg-[#ded5bf] text-[#6e6049]',
  clay: 'bg-[#c87552] text-[#5d2d1c]',
  sun: 'bg-[#dcae56] text-[#654714]',
  rose: 'bg-[#d2a29a] text-[#673d38]',
  forest: 'bg-[#758574] text-[#26352a]',
  ink: 'bg-[#667078] text-[#202a31]',
} satisfies Readonly<Record<ProductTone, string>>
