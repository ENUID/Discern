'use client'

import { useState } from 'react'
import { useServerInsertedHTML } from 'next/navigation'
import { StyleRegistry, createStyleRegistry } from 'styled-jsx'

/**
 * Server-renders the styled-jsx CSS.
 *
 * In the App Router, `<style jsx>` inside a client component is not collected
 * during SSR on its own — the server sends the markup with its generated
 * `jsx-…` class names and none of the rules that go with them. The page is
 * therefore fully unstyled until the JavaScript loads and styled-jsx injects at
 * runtime: raw stacked text, buttons as bare pills, for as long as the bundle
 * takes. On a warm connection that is a blink; on a cold one it is the whole
 * first impression, and it is what you see opening the site after a while away.
 *
 * `useServerInsertedHTML` is the hook Next provides for exactly this: the
 * registry collects every rule rendered on the server and flushes it into the
 * document head with the HTML, so the first paint is already styled.
 */
export default function StyledJsxRegistry({ children }: { children: React.ReactNode }) {
  const [registry] = useState(() => createStyleRegistry())

  useServerInsertedHTML(() => {
    const styles = registry.styles()
    registry.flush()
    return <>{styles}</>
  })

  return <StyleRegistry registry={registry}>{children}</StyleRegistry>
}
