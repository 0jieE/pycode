"""Import every model so Base.metadata (and Alembic autogenerate) sees all tables."""
from app.models.activity import Activity
from app.models.activity_log import ActivityLog
from app.models.classroom import Classroom
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.execution import Execution, ExecutionKind, ExecutionMode, ExecutionStatus
from app.models.invite_code import InviteCode
from app.models.lab import Lab, LoginEvent, LoginOutcome
from app.models.lab_session import LabSession
from app.models.registration_code import RegistrationCode
from app.models.storage import StorageLimit
from app.models.submission import Submission, SubmissionFile, SubmissionStatus
from app.models.test_case import MatchMode, TestCase
from app.models.tutorial import TutorialLesson, TutorialProgress
from app.models.user import Role, User
from app.models.workspace import FileVersion, Workspace, WorkspaceFile

__all__ = [
    "Activity", "ActivityLog", "Classroom", "Enrollment", "EnrollmentStatus", "Execution",
    "ExecutionKind", "ExecutionMode", "ExecutionStatus", "InviteCode", "Lab", "LoginEvent", "LoginOutcome",
    "StorageLimit", "MatchMode", "TestCase", "LabSession", "RegistrationCode", "Submission", "SubmissionFile",
    "SubmissionStatus", "Role", "TutorialLesson", "TutorialProgress", "User", "FileVersion", "Workspace", "WorkspaceFile",
]
