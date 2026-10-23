import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateClass } from '@/api/queries/classes'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'

/** Philippine school years run June to May: from June 2026 on it is "2026-2027". */
function currentSchoolYear(now = new Date()): string {
  const year = now.getFullYear()
  const start = now.getMonth() >= 5 ? year : year - 1
  return `${start}-${start + 1}`
}

export function ClassFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="New class">
      <ClassForm onClose={onClose} />
    </Dialog>
  )
}

function ClassForm({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreateClass()
  const [name, setName] = useState('')
  const [yearAndSection, setYearAndSection] = useState('')
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear)
  const [errors, setErrors] = useState<{
    name?: string
    year_and_section?: string
    school_year?: string
  }>({})
  const [formError, setFormError] = useState<string | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const found: typeof errors = {}
    if (!name.trim()) found.name = 'Enter the class name.'
    if (!yearAndSection.trim()) found.year_and_section = 'Enter the year and section.'
    if (!schoolYear.trim()) found.school_year = 'Enter the school year.'
    setErrors(found)
    if (Object.keys(found).length) return

    create.mutate(
      {
        name: name.trim(),
        year_and_section: yearAndSection.trim(),
        school_year: schoolYear.trim(),
      },
      {
        onSuccess: (created) => {
          toast.success('Class created')
          onClose()
          navigate(`/classes/${created.id}`)
        },
        onError: (err) => setFormError(errorMessage(err)),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        <div className="flex flex-col gap-4">
          {formError && (
            <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
              {formError}
            </p>
          )}
          <TextField
            label="Class name"
            placeholder="e.g. Introduction to Programming"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            maxLength={150}
            autoFocus
          />
          <TextField
            label="Year and section"
            placeholder="e.g. BSIT 1-A"
            value={yearAndSection}
            onChange={(e) => setYearAndSection(e.target.value)}
            error={errors.year_and_section}
            maxLength={50}
          />
          <TextField
            label="School year"
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
            error={errors.school_year}
            maxLength={20}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Create class
        </Button>
      </DialogFooter>
    </form>
  )
}
