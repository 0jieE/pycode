import { Outlet } from 'react-router-dom'
import { useClassSocket } from '@/features/workspace/useClassSocket'
import { useIdParam } from '@/lib/params'

/**
 * Wraps every page of one class on the student side (class home, workspace). The live connection
 * lives here, so moving between those pages keeps it open instead of closing one connection and
 * opening another (which would flicker the student offline on the instructor's monitor).
 * It tells the page when the lab opens or closes and when an activity is published, and its
 * heartbeat is what makes the student show as "online".
 */
export function StudentClassLayout() {
  const classId = useIdParam('classId')
  return (
    <>
      {classId !== null && <ClassConnection classId={classId} />}
      <Outlet />
    </>
  )
}

function ClassConnection({ classId }: { classId: number }) {
  useClassSocket(classId, { heartbeat: true })
  return null
}
