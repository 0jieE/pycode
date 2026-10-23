import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileCode2, FolderUp } from 'lucide-react'
import { useActivities, useCreateActivity, useUpdateActivity } from '@/api/queries/activities'
import { useAllClasses } from '@/api/queries/classes'
import { fetchFile } from '@/api/queries/workspace'
import { errorMessage } from '@/api/errors'
import type { StarterFile } from '@/api/types'
import { PRACTICE } from '@/api/workspaceScope'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { SelectField } from '@/components/ui/SelectField'
import { toast } from '@/components/ui/toastStore'
import { baseName } from '@/lib/paths'
import { defaultEntryFile, filesInFolder, starterFilesProblem } from '@/lib/starterFiles'
import type { Saver } from './saver'

interface TreeEntry {
  id: number
  path: string
  is_folder: boolean
}

interface AttachProps {
  /** The folder (no folders inside it) whose files become an activity's starter files. */
  folder: string | null
  entries: readonly TreeEntry[]
  saver: Saver
  onClose: () => void
}

/**
 * An instructor's My workspace folder, made into a class activity: its files become the starter files of a new
 * draft activity (named after the folder), or replace those of a draft that is not published yet.
 */
export function AttachToActivityDialog({ folder, entries, saver, onClose }: AttachProps) {
  return (
    <Dialog open={folder !== null} onClose={onClose} title="Attach to an activity">
      {folder !== null && (
        <AttachForm
          key={folder}
          folder={folder}
          entries={entries}
          saver={saver}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

const NEW = 'new'

function AttachForm({ folder, entries, saver, onClose }: AttachProps & { folder: string }) {
  const navigate = useNavigate()
  const classes = useAllClasses(false)
  const [classId, setClassId] = useState<number | null>(null)
  const chosenClass = classId ?? classes.data?.[0]?.id ?? null
  const activities = useActivities(
    chosenClass ?? 0,
    { page: 1, size: 100 },
    { enabled: chosenClass !== null },
  )
  // Only a draft's starter files can change: once published, students already have their copy.
  const drafts = (activities.data?.items ?? []).filter((a) => !a.is_published)
  const [target, setTarget] = useState(NEW)

  const files = filesInFolder(folder, entries)
  const names = files.map((f) => f.name)
  const [entry, setEntry] = useState(defaultEntryFile(names) ?? '')
  const pyFiles = names.filter((n) => n.toLowerCase().endsWith('.py'))

  const create = useCreateActivity(chosenClass ?? 0)
  const update = useUpdateActivity(chosenClass ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = baseName(folder)

  async function attach() {
    if (chosenClass === null) return
    setError(null)
    if (files.length === 0) return setError('This folder is empty: add a file first.')
    if (!entry) return setError('The folder needs a .py file for students to run.')
    setBusy(true)
    try {
      // What is in the editor counts, even if it was typed a second ago.
      await saver.saveAll()
      const starter: StarterFile[] = await Promise.all(
        files.map(async (f) => ({
          path: f.name,
          content: (await fetchFile(PRACTICE, f.id)).content ?? '',
        })),
      )
      const problem = starterFilesProblem(starter)
      if (problem) {
        setError(problem)
        return
      }
      const activity =
        target === NEW
          ? await create.mutateAsync({
              title,
              starter_files: starter,
              entry_file: entry,
              ignore_input_prompts: true,
            })
          : await update.mutateAsync({
              id: Number(target),
              body: { starter_files: starter, entry_file: entry },
            })
      onClose()
      const where = classes.data?.find((c) => c.id === chosenClass)?.name ?? 'the class'
      toast.success(
        target === NEW
          ? `Draft activity "${activity.title}" created in ${where}`
          : `Starter files of "${activity.title}" replaced`,
      )
      navigate(`/classes/${chosenClass}/activities/${activity.id}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const noClasses = classes.isSuccess && classes.data.length === 0

  return (
    <>
      <DialogBody>
        <div className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}

          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <FolderUp aria-hidden className="size-4 text-ink-muted" />
              <span className="font-mono">{folder}</span>
              <span className="text-ink-muted">
                · {files.length} {files.length === 1 ? 'file' : 'files'}
              </span>
            </p>
            {files.length > 0 && (
              <ul className="mt-1.5 flex max-h-28 flex-col gap-0.5 overflow-auto">
                {names.map((n) => (
                  <li
                    key={n}
                    className="flex items-center gap-1.5 font-mono text-xs text-ink-muted"
                  >
                    <FileCode2 aria-hidden className="size-3.5" />
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {noClasses ? (
            <p className="text-sm text-ink-muted">You have no classes yet. Create a class first.</p>
          ) : (
            <>
              <SelectField
                label="Class"
                value={chosenClass === null ? '' : String(chosenClass)}
                disabled={classes.isPending}
                onChange={(e) => {
                  setClassId(Number(e.target.value))
                  setTarget(NEW)
                }}
                options={
                  classes.isPending
                    ? [{ value: '', label: 'Loading your classes…' }]
                    : (classes.data ?? []).map((c) => ({
                        value: String(c.id),
                        label: `${c.name} · ${c.year_and_section}`,
                      }))
                }
              />
              <div className="flex flex-col gap-1">
                <SelectField
                  label="Activity"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  options={[
                    { value: NEW, label: `New draft activity: ${title}` },
                    ...drafts.map((a) => ({
                      value: String(a.id),
                      label: `Replace the files of draft: ${a.title}`,
                    })),
                  ]}
                />
                <p className="text-xs text-ink-muted">
                  {target === NEW
                    ? 'A new activity named after the folder, not published yet: add instructions and tests, then publish it.'
                    : "The draft's starter files are replaced by this folder's files. Published activities cannot change their files."}
                </p>
              </div>
              <SelectField
                label="File students run (and that tests grade)"
                value={entry}
                disabled={pyFiles.length === 0}
                onChange={(e) => setEntry(e.target.value)}
                options={
                  pyFiles.length === 0
                    ? [{ value: '', label: 'No .py file in this folder' }]
                    : pyFiles.map((n) => ({ value: n, label: n }))
                }
              />
            </>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={noClasses || chosenClass === null || files.length === 0 || !entry}
          onClick={() => void attach()}
        >
          {target === NEW ? 'Create activity' : 'Replace files'}
        </Button>
      </DialogFooter>
    </>
  )
}
