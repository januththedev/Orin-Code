import { create } from 'zustand'
import { bridge } from '../bridge/client'
import {
  buildMemorySection,
  isValidName,
  parseMemory,
  serialiseMemory,
  toSlug,
  type Memory,
} from '../features/memory/memoryModel'

/**
 * Memory, backed by files in the same place ZCode keeps them.
 *
 * The previous implementation kept memories in a key in the app's key-value
 * store. That was the wrong place: ZCode stores memories as one file per fact
 * under `<storage>/memories/projects/<slug>-<hash>/memory/`, and a memory that
 * means something different in each product is not a shared memory.
 *
 * This store is a cache over that directory. The files are the source of
 * truth, so an edit made outside the app is picked up on the next read, and
 * deleting a file in the app deletes it for real.
 */

export interface MemoryProblem {
  file: string
  field: string
  message: string
}

interface MemoryState {
  /** Parsed memories, sorted by name. */
  memories: Memory[]
  /** Files that failed to parse, so they can be shown rather than hidden. */
  problems: MemoryProblem[]
  /** Where the files live, for display. */
  directory: string
  loading: boolean
  /** True once a load has completed, so the UI is not just "loading" forever. */
  loaded: boolean
  reload: () => Promise<void>
  save: (memory: Memory) => Promise<void>
  remove: (name: string) => Promise<void>
  /** The system section, or null when there is nothing to say. */
  section: () => string | null
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  problems: [],
  directory: '',
  loading: false,
  loaded: false,

  reload: async () => {
    set({ loading: true })
    try {
      const [directory, files] = await Promise.all([
        bridge.memoryDir().catch(() => ''),
        bridge.memoryList().catch(() => [] as Awaited<ReturnType<typeof bridge.memoryList>>),
      ])
      const memories: Memory[] = []
      const problems: MemoryProblem[] = []
      for (const file of files) {
        const { memory, problems: fileProblems } = parseMemory(file.content, file.name)
        if (memory) {
          memories.push({ ...memory, updatedAt: file.updatedAtMs ? new Date(file.updatedAtMs).toISOString() : null })
        }
        for (const problem of fileProblems) problems.push({ file: file.name, ...problem })
      }
      memories.sort((a, b) => a.name.localeCompare(b.name))
      set({ memories, problems, directory, loading: false, loaded: true })
    } catch {
      // No workspace, or no memory directory yet. That is a normal state, not
      // an error, and the page renders an empty memory.
      set({ memories: [], problems: [], loading: false, loaded: true })
    }
  },

  save: async (memory) => {
    const name = isValidName(memory.name) ? memory.name : toSlug(memory.name)
    if (!name) throw new Error('That memory needs a name.')
    await bridge.memoryWrite(`${name}.md`, serialiseMemory({ ...memory, name }))
    await get().reload()
  },

  remove: async (name) => {
    await bridge.memoryDelete(`${name}.md`)
    await get().reload()
  },

  section: () => buildMemorySection(get().memories),
}))

/**
 * Read the memory block for a send without subscribing the caller to the store.
 *
 * The send path is a plain function; reading through the hook would re-render
 * the composer on every memory change.
 */
export function memorySection(): string | null {
  return buildMemorySection(useMemoryStore.getState().memories)
}
