/** Largest page the API allows. */
export const MAX_PAGE_SIZE = 100

interface PageShape<T> {
  items: T[]
  total: number
}

/** Walks every page of a list endpoint and returns all items. For lists a screen needs in full. */
export async function fetchAllPages<T>(
  fetchPage: (page: number, size: number) => Promise<PageShape<T>>,
): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; ; page++) {
    const result = await fetchPage(page, MAX_PAGE_SIZE)
    all.push(...result.items)
    if (all.length >= result.total || result.items.length === 0) return all
  }
}
