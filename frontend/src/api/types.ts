import type { components } from './schema'

/** Friendly aliases over the generated OpenAPI types. Never hand-write API shapes. */
type Schemas = components['schemas']

export type User = Schemas['UserOut']
export type Role = Schemas['Role']
export type LoginRequest = Schemas['LoginRequest']

export type UserCreate = Schemas['UserCreate']
export type UserUpdate = Schemas['UserUpdate']
export type UserPage = Schemas['Page_UserOut_']
export type ResetPasswordResponse = Schemas['ResetPasswordResponse']
export type ImportResult = Schemas['ImportResult']
export type ImportRowError = Schemas['ImportRowError']

export type ClassOut = Schemas['ClassOut']
export type ClassCreate = Schemas['ClassCreate']
export type ClassUpdate = Schemas['ClassUpdate']
export type ClassPage = Schemas['Page_ClassOut_']

export type InviteCode = Schemas['InviteCodeOut']
export type InviteCodeCreate = Schemas['InviteCodeCreate']
export type InviteCodeUpdate = Schemas['InviteCodeUpdate']
export type InviteCodePage = Schemas['Page_InviteCodeOut_']

export type Enrollment = Schemas['EnrollmentOut']
export type EnrollmentPage = Schemas['Page_EnrollmentOut_']
export type EnrollmentAction = Schemas['EnrollmentReview']['action']
export type EnrollmentStatus = Enrollment['status']
export type StudentBrief = Schemas['StudentBrief']

export type LabSession = Schemas['SessionOut']
export type SessionUpdate = Schemas['SessionUpdate']
export type SessionCreate = Schemas['SessionCreate']
export type SessionPage = Schemas['Page_SessionOut_']

export type Activity = Schemas['ActivityOut']
export type ActivityCreate = Schemas['ActivityCreate']
export type ActivityUpdate = Schemas['ActivityUpdate']
export type ActivityPage = Schemas['Page_ActivityOut_']
export type StarterFile = Schemas['StarterFile']

export type SubmissionListItem = Schemas['SubmissionListItem']
export type SubmissionPage = Schemas['Page_SubmissionListItem_']
export type SubmissionDetail = Schemas['SubmissionDetail']

export type MyClass = Schemas['MyClassOut']
export type MyClassPage = Schemas['Page_MyClassOut_']
export type EnrollResponse = Schemas['EnrollResponse']

export type FileMeta = Schemas['FileMeta']
export type FileOut = Schemas['FileOut']
export type TreeOut = Schemas['TreeOut']
export type Usage = Schemas['Usage']
export type CreateEntryRequest = Schemas['CreateEntryRequest']
export type VersionMeta = Schemas['VersionMeta']
export type VersionOut = Schemas['VersionOut']
export type VersionPage = Schemas['Page_VersionMeta_']
export type SubmissionOut = Schemas['SubmissionOut']

export type MySubmission = Schemas['MySubmissionOut']

export type ExecutionOut = Schemas['ExecutionOut']
export type ExecutionStatus = ExecutionOut['status']
export type RunResponse = Schemas['RunResponse']
export type MonitorSnapshot = Schemas['MonitorSnapshot']
export type StudentMonitor = Schemas['StudentMonitor']
export type LastRun = Schemas['LastRun']

export type RegisterRequest = Schemas['RegisterRequest']
export type RegistrationCodeCreate = Schemas['RegistrationCodeCreate']
export type RegistrationCodesCreated = Schemas['RegistrationCodesCreated']
export type RegistrationCodeOut = Schemas['RegistrationCodeOut']
export type RegistrationCodePage = Schemas['Page_RegistrationCodeOut_']
export type BatchOut = Schemas['BatchOut']
export type RevokeResult = Schemas['RevokeResult']

export type TestCase = Schemas['CaseOut']
export type TestCaseCreate = Schemas['CaseCreate']
export type TestCaseUpdate = Schemas['CaseUpdate']
export type MatchMode = Schemas['MatchMode']
export type StudentCaseSample = Schemas['StudentCaseSample']
export type StudentCaseHidden = Schemas['StudentCaseHidden']
export type StudentCase = StudentCaseSample | StudentCaseHidden
export type TestSummary = Schemas['TestSummary']
export type RegradeResult = Schemas['RegradeResult']

export type ProfileUpdate = Schemas['ProfileUpdate']
export type ChangePasswordRequest = Schemas['ChangePasswordRequest']

/** The signed-in user, as login and /auth/me return them: the user plus their preferences. */
export type Me = Schemas['MeOut']
export type Preferences = Schemas['Preferences']
export type PreferencesUpdate = Schemas['PreferencesUpdate']

/** A lab: a named computer room that sessions book. */
export type Lab = Schemas['LabOut']
/** POST /labs and PATCH /labs/{id} (rename). */
export type LabCreate = Schemas['LabCreate']

export type LessonListItem = Schemas['LessonListItem']
export type LessonDetail = Schemas['LessonDetail']
export type LessonFull = Schemas['LessonFull']
export type LessonCreate = Schemas['LessonCreate']
export type LessonUpdate = Schemas['LessonUpdate']
export type LessonExample = Schemas['ExampleSpec']
export type ExerciseSpec = Schemas['ExerciseSpec']
export type TutorialTestSpec = Schemas['TestSpec']
export type StudentExercise = Schemas['StudentExercise']
export type TutorialProgress = Schemas['ProgressOut']
export type TutorialMatrix = Schemas['TutorialMatrix']
export type TutorialProgressCell = Schemas['ProgressCell']

export type SessionLogin = Schemas['LoginOut']
export type SessionLoginPage = Schemas['Page_LoginOut_']
export type LoginOutcome = Schemas['LoginOutcome']

export type LabBooking = Schemas['LabBooking']

export type StorageLimits = Schemas['Limits']
export type RoleStorageLimits = Schemas['RoleLimits']
export type StorageBounds = Schemas['Bounds']
export type StorageLimitsOut = Schemas['StorageLimitsOut']
export type StorageLimitsUpdate = Schemas['LimitsUpdate']
export type UserStorage = Schemas['UserStorageOut']
export type UserStorageUpdate = Schemas['LimitsOverride']
export type WorkspaceUsage = Schemas['WorkspaceUsage']
export type ClearResult = Schemas['ClearResult']
export type Requirements = Schemas['Requirements']
