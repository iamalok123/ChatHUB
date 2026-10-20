import '@testing-library/jest-dom/vitest'

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => {
    const minWidth = query.match(/min-width:\s*(\d+)px/)
    const matches = minWidth ? window.innerWidth >= Number(minWidth[1]) : false
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }
  }
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined
}
