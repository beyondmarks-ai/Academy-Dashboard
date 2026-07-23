"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  adminCreateInvitation,
  adminGetInvitations,
  adminGetStudents,
  adminResetStudentPassword,
  adminSetStudentStatus,
  type AdminInvitation,
  type AdminStudent,
} from "@/lib/academy-api";

export function AdminDashboard({ adminName, onSignOut }: { adminName: string; onSignOut: () => void }) {
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [section, setSection] = useState<"students" | "invitations">("students");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resetStudent, setResetStudent] = useState<AdminStudent | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [studentData, invitationData] = await Promise.all([adminGetStudents(), adminGetInvitations()]);
      setStudents(studentData);
      setInvitations(invitationData);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Administration data could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const visibleStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) =>
      [student.full_name, student.academy_id, student.admission_id || "", student.role, student.status]
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [search, students]);

  const activeCount = students.filter((student) => student.status === "active").length;
  const suspendedCount = students.filter((student) => student.status === "suspended").length;
  const openInvitations = invitations.filter((invite) => !invite.claimed_at && (!invite.expires_at || new Date(invite.expires_at) > new Date())).length;

  const changeStatus = async (student: AdminStudent) => {
    const nextStatus = student.status === "active" ? "suspended" : "active";
    if (nextStatus === "suspended" && !window.confirm(`Suspend ${student.academy_id} and revoke all active sessions?`)) return;
    setActionPending(true);
    try {
      const updated = await adminSetStudentStatus(student.id, nextStatus);
      setStudents((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Student status could not be updated.");
    } finally {
      setActionPending(false);
    }
  };

  return (
    <main className="admin-screen">
      <div className="admin-background" />
      <header className="admin-header">
        <div className="admin-brand">
          <span><Image src="/beyond-marks-logo.jpeg" alt="Beyond Marks" fill sizes="46px" /></span>
          <div><strong>Beyond Marks</strong><small>Academy Administration</small></div>
        </div>
        <div className="admin-account">
          <span>{adminName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{adminName}</strong><small>Administrator</small></div>
          <button type="button" onClick={onSignOut}>Log out</button>
        </div>
      </header>

      <section className="admin-content">
        <div className="admin-welcome">
          <div><p>ACADEMY CONTROL CENTER</p><h1>Welcome, <span>{adminName}</span></h1><small>Manage learner access, accounts and invitations from one secure workspace.</small></div>
          <button type="button" onClick={() => setInviteOpen(true)}><i>+</i> Issue Admission ID</button>
        </div>

        <section className="admin-stat-grid" aria-label="Academy account summary">
          <article><span>Total learners</span><strong>{students.length}</strong><small>Registered Academy accounts</small></article>
          <article><span>Active accounts</span><strong>{activeCount}</strong><small>Currently permitted to sign in</small></article>
          <article><span>Suspended</span><strong>{suspendedCount}</strong><small>Sessions and access revoked</small></article>
          <article><span>Open invitations</span><strong>{openInvitations}</strong><small>Available Admission IDs</small></article>
        </section>

        {error && <div className="admin-error" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div>}

        <section className="admin-panel">
          <div className="admin-panel-toolbar">
            <div className="admin-tabs" role="tablist">
              <button type="button" className={section === "students" ? "active" : ""} onClick={() => setSection("students")}>Students <span>{students.length}</span></button>
              <button type="button" className={section === "invitations" ? "active" : ""} onClick={() => setSection("invitations")}>Admission IDs <span>{invitations.length}</span></button>
            </div>
            {section === "students" && <label className="admin-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, Academy ID or Admission ID" /></label>}
            <button className="admin-refresh" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          </div>

          {section === "students" ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Student</th><th>Admission ID</th><th>Role</th><th>Status</th><th>Last active</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleStudents.map((student) => (
                    <tr key={student.id}>
                      <td><div className="admin-student"><span>{student.full_name.slice(0, 1).toUpperCase()}</span><div><strong>{student.full_name}</strong><small>{student.academy_id}</small></div></div></td>
                      <td><code>{student.admission_id || "Not assigned"}</code></td>
                      <td><span className={`admin-role ${student.role}`}>{student.role}</span></td>
                      <td><span className={`admin-status ${student.status}`}><i />{student.status}</span></td>
                      <td>{student.last_seen_at ? new Date(student.last_seen_at).toLocaleString() : "Never"}</td>
                      <td><div className="admin-row-actions"><button type="button" onClick={() => setResetStudent(student)}>Reset password</button><button type="button" className={student.status === "active" ? "danger" : "success"} disabled={actionPending} onClick={() => void changeStatus(student)}>{student.status === "active" ? "Suspend" : "Activate"}</button></div></td>
                    </tr>
                  ))}
                  {!loading && !visibleStudents.length && <tr><td colSpan={6}><div className="admin-empty"><strong>No students found</strong><span>New students appear after claiming an Admission ID.</span></div></td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-invite-grid">
              {invitations.map((invite) => {
                const expired = Boolean(invite.expires_at && new Date(invite.expires_at) <= new Date());
                const state = invite.claimed_at ? "claimed" : expired ? "expired" : "available";
                return <article key={invite.id}>
                  <div><span className={`admin-invite-state ${state}`}><i />{state}</span><small>{invite.assigned_role}</small></div>
                  <h3>{invite.admission_id}</h3>
                  <p>{invite.allowed_academy_id || "Can be claimed by any Academy ID"}</p>
                  <footer><span>{invite.claimed_by_academy_id ? `Claimed by ${invite.claimed_by_academy_id}` : invite.expires_at ? `Expires ${new Date(invite.expires_at).toLocaleDateString()}` : "No expiration"}</span><time>{new Date(invite.created_at).toLocaleDateString()}</time></footer>
                </article>;
              })}
              {!loading && !invitations.length && <div className="admin-empty"><strong>No Admission IDs issued</strong><span>Issue the first invitation to onboard a student.</span></div>}
            </div>
          )}
        </section>
      </section>

      {inviteOpen && <InviteDialog pending={actionPending} onClose={() => setInviteOpen(false)} onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setActionPending(true);
        try {
          const expiresLocal = String(data.get("expiresAt") || "");
          const invitation = await adminCreateInvitation({
            admissionId: String(data.get("admissionId") || "").trim(),
            allowedAcademyId: String(data.get("allowedAcademyId") || "").trim(),
            role: String(data.get("role") || "student") as "student" | "developer",
            expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() : "",
          });
          setInvitations((items) => [invitation, ...items.filter((item) => item.id !== invitation.id)]);
          setInviteOpen(false);
          setSection("invitations");
          setError("");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Admission ID could not be issued.");
        } finally {
          setActionPending(false);
        }
      }} />}

      {resetStudent && <ResetPasswordDialog student={resetStudent} pending={actionPending} onClose={() => setResetStudent(null)} onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const password = String(data.get("password") || "");
        if (password !== String(data.get("confirmPassword") || "")) { setError("Passwords do not match."); return; }
        setActionPending(true);
        try {
          await adminResetStudentPassword(resetStudent.id, password);
          setResetStudent(null);
          setError("");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Password could not be reset.");
        } finally {
          setActionPending(false);
        }
      }} />}
    </main>
  );
}

function InviteDialog({ pending, onClose, onSubmit }: { pending: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="admin-modal-layer" onMouseDown={onClose}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" onMouseDown={(event) => event.stopPropagation()}>
    <button className="admin-modal-close" type="button" onClick={onClose}>×</button><span>STUDENT ONBOARDING</span><h2 id="invite-title">Issue an Admission ID</h2><p>Bind the invitation to one Academy ID for the strongest protection.</p>
    <form onSubmit={onSubmit}>
      <label><span>Admission ID</span><input name="admissionId" placeholder="BM-2026-001" required autoFocus /></label>
      <label><span>Allowed Academy ID <small>Optional</small></span><input name="allowedAcademyId" placeholder="student@beyondmarks.ai" /></label>
      <div className="admin-form-grid"><label><span>Account role</span><select name="role"><option value="student">Student</option><option value="developer">Developer</option></select></label><label><span>Expires <small>Optional</small></span><input name="expiresAt" type="datetime-local" /></label></div>
      <button className="admin-primary-button" type="submit" disabled={pending}>{pending ? "Issuing…" : "Issue Admission ID"}</button>
    </form>
  </section></div>;
}

function ResetPasswordDialog({ student, pending, onClose, onSubmit }: { student: AdminStudent; pending: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="admin-modal-layer" onMouseDown={onClose}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onMouseDown={(event) => event.stopPropagation()}>
    <button className="admin-modal-close" type="button" onClick={onClose}>×</button><span>ACCOUNT SECURITY</span><h2 id="reset-title">Reset student password</h2><p>This immediately signs <strong>{student.academy_id}</strong> out from every device.</p>
    <form onSubmit={onSubmit}>
      <label><span>New password</span><input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder="At least 12 characters" required autoFocus /></label>
      <label><span>Confirm password</span><input name="confirmPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
      <button className="admin-primary-button" type="submit" disabled={pending}>{pending ? "Resetting…" : "Reset password & revoke sessions"}</button>
    </form>
  </section></div>;
}
