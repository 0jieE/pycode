import { createBrowserRouter } from 'react-router-dom'
import { RequireRole } from '@/auth/RequireRole'
import { PageFrame } from '@/components/PageFrame'
import { Shell } from '@/components/Shell'
import { ClassHome } from '@/features/student/ClassHome'
import { StudentBrowserLayout } from '@/features/student/StudentBrowserLayout'
import { StudentClassLayout } from '@/features/student/StudentClassLayout'
import { MyClassesPage } from '@/features/student/MyClassesPage'
import { RegistrationCodesPage } from '@/features/admin/RegistrationCodesPage'
import { StorageLimitsPage } from '@/features/admin/StorageLimitsPage'
import { CodesPanel, StoragePanel, UsersPanel } from '@/features/admin/AdminPanels'
import { SidePanelFrame } from '@/components/SidePanel'
import { UsersPage } from '@/features/admin/UsersPage'
import { ClassDetailPage } from '@/features/instructor/ClassDetailPage'
import { ClassesPage } from '@/features/instructor/ClassesPage'
import { InstructorBrowserLayout } from '@/features/instructor/InstructorBrowserLayout'
import { MonitorPage } from '@/features/instructor/MonitorPage'
import { SubmissionsPage } from '@/features/instructor/SubmissionsPage'
import { AccountPage } from '@/features/account/AccountPage'
import { LabDetail, LabsFrame, LabsIndex } from '@/features/labs/LabsFrame'
import { ChangePasswordRequiredPage } from '@/features/account/ChangePasswordRequiredPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { SignupPage } from '@/features/auth/SignupPage'
import { NotFoundPage, RootRedirect, RouteErrorPage } from '@/features/auth/RouteMessages'

export const router = createBrowserRouter(
  [
    {
      errorElement: <RouteErrorPage />,
      children: [
        { path: '/', element: <RootRedirect /> },
        { path: '/login', element: <LoginPage /> },
        { path: '/signup', element: <SignupPage /> },
        {
          element: <RequireRole roles={['admin']} />,
          children: [
            // Each with its list beside it, like the classes and the labs.
            {
              element: <SidePanelFrame panel={<UsersPanel />} />,
              children: [
                { path: '/admin/users', element: <UsersPage /> },
                { path: '/admin/users/:role', element: <UsersPage /> },
              ],
            },
            {
              element: <SidePanelFrame panel={<CodesPanel />} />,
              children: [
                { path: '/admin/registration-codes', element: <RegistrationCodesPage /> },
                { path: '/admin/registration-codes/:batch', element: <RegistrationCodesPage /> },
              ],
            },
            {
              element: <SidePanelFrame panel={<StoragePanel />} />,
              children: [
                { path: '/admin/storage', element: <StorageLimitsPage /> },
                { path: '/admin/storage/:role', element: <StorageLimitsPage /> },
              ],
            },
          ],
        },
        {
          element: <RequireRole roles={['instructor']} />,
          children: [
            {
              // The top bar, the icon strip and the class list are on every instructor page.
              element: <Shell />,
              children: [
                {
                  element: <InstructorBrowserLayout />,
                  children: [
                    { path: '/classes', element: <ClassesPage /> },
                    { path: '/classes/:classId', element: <ClassDetailPage /> },
                    // CodeMirror is big: only load it on the pages that show code.
                    {
                      path: '/classes/:classId/activities/new',
                      lazy: async () => ({
                        Component: (await import('@/features/instructor/ActivityEditorPage'))
                          .ActivityEditorPage,
                      }),
                    },
                    {
                      path: '/classes/:classId/activities/:activityId',
                      lazy: async () => ({
                        Component: (await import('@/features/instructor/ActivityEditorPage'))
                          .ActivityEditorPage,
                      }),
                    },
                    {
                      path: '/classes/:classId/activities/:activityId/submissions',
                      element: <SubmissionsPage />,
                    },
                    {
                      path: '/classes/:classId/activities/:activityId/submissions/:submissionId',
                      lazy: async () => ({
                        Component: (await import('@/features/instructor/SubmissionViewerPage'))
                          .SubmissionViewerPage,
                      }),
                    },
                    {
                      path: '/classes/:classId/sessions/:sessionId/monitor',
                      element: <MonitorPage />,
                    },
                    {
                      path: '/classes/:classId/students/:studentId/workspace',
                      lazy: async () => ({
                        Component: (await import('@/features/instructor/StudentWorkspaceViewer'))
                          .default,
                      }),
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          element: <RequireRole roles={['student']} />,
          children: [
            {
              // The top bar and the icon strip are on every student page.
              element: <Shell />,
              children: [
                {
                  element: <StudentBrowserLayout />,
                  children: [{ path: '/my/classes', element: <MyClassesPage /> }],
                },
                // Everything inside one class shares a single live connection (see StudentClassLayout).
                {
                  path: '/my/classes/:classId',
                  element: <StudentClassLayout />,
                  children: [
                    {
                      element: <StudentBrowserLayout />,
                      children: [{ index: true, element: <ClassHome /> }],
                    },
                    // The IDE brings its own explorer as its second side bar. It loads on demand:
                    // CodeMirror only downloads when a student opens a workspace.
                    {
                      path: 'workspace',
                      lazy: async () => ({
                        Component: (await import('@/features/workspace/WorkspacePage')).default,
                      }),
                    },
                  ],
                },
              ],
            },
          ],
        },
        // The personal Practice workspace, for students and instructors (administrators have none: 403).
        // The same IDE, but not tied to a class: no live class connection, no lab status, nothing to
        // submit, and private to its owner.
        {
          element: <RequireRole roles={['student', 'instructor']} />,
          children: [
            {
              element: <Shell />,
              children: [
                {
                  path: '/practice',
                  lazy: async () => ({
                    Component: (await import('@/features/workspace/WorkspacePage')).PracticePage,
                  }),
                },
              ],
            },
          ],
        },
        // The computer rooms, for administrators and instructors, in the frame each already has.
        {
          element: <RequireRole roles={['admin', 'instructor']} />,
          children: [
            {
              // Administrators edit the rooms; instructors see them read-only, with a list of labs beside.
              element: <LabsFrame />,
              children: [
                { path: '/labs', element: <LabsIndex /> },
                { path: '/labs/:labId', element: <LabDetail /> },
              ],
            },
          ],
        },
        // The Python Tutorial: students learn, administrators and instructors edit the lessons. CodeMirror and
        // the Markdown renderer only download when it is opened.
        {
          element: <RequireRole roles={['admin', 'instructor', 'student']} />,
          children: [
            {
              lazy: async () => ({
                Component: (await import('@/features/tutorial/TutorialFrame')).TutorialFrame,
              }),
              children: [
                {
                  path: '/tutorial',
                  lazy: async () => ({
                    Component: (await import('@/features/tutorial/TutorialFrame')).TutorialIndex,
                  }),
                },
                {
                  path: '/tutorial/:slug',
                  lazy: async () => ({
                    Component: (await import('@/features/tutorial/TutorialFrame')).TutorialLesson,
                  }),
                },
              ],
            },
          ],
        },
        // Account settings, for every role, in the frame that role already has.
        {
          element: <RequireRole roles={['admin', 'instructor', 'student']} />,
          children: [
            {
              path: '/account',
              element: <PageFrame />,
              children: [{ index: true, element: <AccountPage /> }],
            },
          ],
        },
        // Where a user with a temporary password is sent: it works for any role and is exempt from the
        // "must change your password" redirect that every other page applies (see RequireRole).
        { path: '/change-password', element: <ChangePasswordRequiredPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  {
    // Opt in to the React Router v7 behaviour now so the console stays free of upgrade warnings.
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
)
