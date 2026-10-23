import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateLesson } from '@/api/queries/tutorial'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { isValidSlug, slugify } from '@/lib/tutorial'

/** A new lesson: its title and address. It starts hidden, with placeholder text, and opens in the editor. */
export function NewLessonDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="New lesson">
      <NewLessonForm onClose={onClose} />
    </Dialog>
  )
}

function NewLessonForm({ onClose }: { onClose: () => void }) {
  const create = useCreateLesson()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownSlug = slugTouched ? slug : slugify(title)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Give the lesson a title.')
    if (!isValidSlug(shownSlug)) {
      return setError(
        'The address may use lowercase letters, digits and single hyphens (60 at most).',
      )
    }
    setError(null)
    create.mutate(
      {
        slug: shownSlug,
        title: title.trim(),
        summary: '',
        body_md: `## ${title.trim()}\n\nWrite the lesson here.`,
        examples: [],
        // Hidden until it is ready: students never see the placeholder.
        is_hidden: true,
        exercise: {
          prompt: 'Describe what the program must do.',
          starter_code: '',
          starter_files: [],
          entry: 'main.py',
          ignore_input_prompts: true,
          tests: [
            {
              name: 'Test 1',
              stdin: '',
              expected_output: 'Hello',
              is_hidden: false,
              match_mode: 'trim',
              points: 1,
            },
          ],
          reference_solution: 'print("Hello")\n',
        },
      },
      {
        onSuccess: (lesson) => {
          onClose()
          navigate(`/tutorial/${lesson.slug}`)
        },
        onError: (err) => setError(errorMessage(err)),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        <div className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
            autoFocus
          />
          <TextField
            label="Address"
            value={shownSlug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value)
            }}
            maxLength={60}
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-sm text-ink-muted">
            The address is part of the lesson's link (lowercase letters, digits and hyphens). The
            lesson starts hidden from students, with placeholder text and one test. Write it, then
            press Show.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Create lesson
        </Button>
      </DialogFooter>
    </form>
  )
}
