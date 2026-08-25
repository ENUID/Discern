/**
 * The Product shape.
 *
 * This file used to also export a ProductCard component. Nothing rendered it —
 * the product card that ships is the one built inline in the v2 boutique
 * (renderFoundProductCard), and the two had drifted apart. The component is
 * gone; the type stays, because it is the shared contract between the search
 * stack, the chat hook and the page.
 */
import { ExchangeRates } from '@/lib/exchangeRates'

export interface Product {
  id: string
  title: string
  vendor: string
  handle?: string
  store_url: string
  price: number
  currency?: string
  base_currency?: string
  tags: string[]
  in_stock: boolean
  image_url?: string
  description?: string
  description_html?: string
  product_type?: string
  options?: { name: string; values: string[] }[]
  variants?: Array<{
    id: string
    title: string
    price: number
    availability: boolean
    options: Array<{ name: string; label: string }>
    media?: Array<{ url: string; alt?: string }>
  }>
  media?: Array<{ type: string; url: string; alt?: string }>
}

interface Props {
  product: Product
  rates: ExchangeRates
  isBest?: boolean
  saved?: boolean
  onToggleSave?: (product: Product) => void
  ctaLabel?: string
  onClick?: () => void
}
