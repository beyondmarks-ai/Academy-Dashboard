"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  adminCreateInvitation,
  adminGetInvitations,
  adminGetStudents,
  adminResetStudentPassword,
  adminSetStudentStatus,
  adminCreateCampaign,
  adminCreateCourse,
  adminGenerateCertificate,
  adminEnrollStudents,
  adminGetAdmissions,
  adminGetCampaigns,
  adminGetCertificates,
  adminGetCourses,
  adminGetEnrollments,
  adminGetApiRequests,
  adminReviewApiRequest,
  adminManageApiSubscription,
  adminGetApiUsage,
  adminGetServiceRequests,
  adminReviewServiceRequest,
  adminManageServiceEntitlement,
  adminRetryServiceProvisioning,
  adminReviewAdmission,
  adminUpdateEnrollment,
  adminUploadCertificateTemplate,
  type AdminAdmission,
  type AdminCampaign,
  type AdminCourse,
  type AdminEnrollment,
  type AcademyCertificate,
  type AdminInvitation,
  type AdminStudent,
  type AdminApiRequest,
  type ApiUsageDetails,
  type AdminServiceRequest,
  type AzureQuotaUnit,
} from "@/lib/academy-api";
import { AZURE_SERVICE_CATALOG, formatServiceUnits } from "@/lib/azure-catalog";

type OperationsTab = "admissions"|"apiRequests"|"serviceRequests"|"courses"|"certificates"|"notifications";

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
  const [operationsTab,setOperationsTab]=useState<OperationsTab>("admissions");
  const [admissions,setAdmissions]=useState<AdminAdmission[]>([]);
  const [courses,setCourses]=useState<AdminCourse[]>([]);
  const [enrollments,setEnrollments]=useState<AdminEnrollment[]>([]);
  const [certificates,setCertificates]=useState<AcademyCertificate[]>([]);
  const [campaigns,setCampaigns]=useState<AdminCampaign[]>([]);
  const [apiRequests,setApiRequests]=useState<AdminApiRequest[]>([]);
  const [serviceRequests,setServiceRequests]=useState<AdminServiceRequest[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const [studentData, invitationData,admissionData,courseData,enrollmentData,certificateData,campaignData,apiRequestData,serviceRequestData] = await Promise.all([adminGetStudents(), adminGetInvitations(),adminGetAdmissions(),adminGetCourses(),adminGetEnrollments(),adminGetCertificates(),adminGetCampaigns(),adminGetApiRequests(),adminGetServiceRequests()]);
      setStudents(studentData);
      setInvitations(invitationData);
      setAdmissions(admissionData);setCourses(courseData);setEnrollments(enrollmentData);setCertificates(certificateData);setCampaigns(campaignData);
      setApiRequests(apiRequestData);
      setServiceRequests(serviceRequestData);
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
        <OperationsPanel tab={operationsTab} setTab={setOperationsTab} admissions={admissions} apiRequests={apiRequests} serviceRequests={serviceRequests} courses={courses} enrollments={enrollments} certificates={certificates} campaigns={campaigns} students={students} pending={actionPending} setPending={setActionPending} refresh={refresh} setError={setError} />
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

function OperationsPanel({tab,setTab,admissions,apiRequests,serviceRequests,courses,enrollments,certificates,campaigns,students,pending,setPending,refresh,setError}:{tab:OperationsTab;setTab:(value:OperationsTab)=>void;admissions:AdminAdmission[];apiRequests:AdminApiRequest[];serviceRequests:AdminServiceRequest[];courses:AdminCourse[];enrollments:AdminEnrollment[];certificates:AcademyCertificate[];campaigns:AdminCampaign[];students:AdminStudent[];pending:boolean;setPending:(value:boolean)=>void;refresh:()=>Promise<void>;setError:(value:string)=>void}){
  const act=async(task:()=>Promise<unknown>)=>{setPending(true);try{await task();await refresh();setError("");}catch(error){setError(error instanceof Error?error.message:"Operation failed.");}finally{setPending(false);}};
  return <section className="admin-panel admin-operations">
    <div className="admin-panel-toolbar"><div className="admin-tabs">
      {(["admissions","apiRequests","serviceRequests","courses","certificates","notifications"] as const).map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item==="apiRequests"?"Model Access":item==="serviceRequests"?"Azure Services":item[0]!.toUpperCase()+item.slice(1)} <span>{item==="admissions"?admissions.filter(x=>x.status==="pending").length:item==="apiRequests"?apiRequests.filter(x=>x.status==="pending").length:item==="serviceRequests"?serviceRequests.filter(x=>x.status==="pending").length:item==="courses"?courses.length:item==="certificates"?certificates.length:campaigns.length}</span></button>)}
    </div></div>
    {tab==="admissions"&&<div className="admin-ops-grid">{admissions.map(item=><AdmissionCard key={item.id} item={item} pending={pending} act={act}/>)}</div>}
    {tab==="apiRequests"&&<div className="admin-ops-grid api-request-grid">{apiRequests.map(item=><ApiRequestCard key={item.id} item={item} pending={pending} act={act}/>)}{!apiRequests.length&&<div className="admin-empty"><strong>No API requests yet</strong><span>New learner requests will appear here automatically.</span></div>}</div>}
    {tab==="serviceRequests"&&<div className="admin-ops-grid service-request-admin-grid">{serviceRequests.map(item=><ServiceRequestCard key={item.id} item={item} pending={pending} act={act}/>)}{!serviceRequests.length&&<div className="admin-empty"><strong>No Azure service requests yet</strong><span>Student storage, compute and ML requests will appear here.</span></div>}</div>}
    {tab==="courses"&&<><form className="admin-inline-form" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void act(()=>adminCreateCourse({code:String(data.get("code")),title:String(data.get("title")),description:String(data.get("description")),duration:String(data.get("duration")),status:"active"}));event.currentTarget.reset();}}><input name="code" placeholder="Course code" required/><input name="title" placeholder="Course title" required/><input name="duration" placeholder="Duration"/><input name="description" placeholder="Short description"/><button disabled={pending}>Create course</button></form><div className="admin-ops-grid">{courses.map(course=><article className="admin-op-card" key={course.id}><span>COURSE · {course.code}</span><h3>{course.title}</h3><p>{course.description||"No description"}</p><footer>{course.enrollment_count} enrolled · {course.completion_count} completed</footer><select defaultValue="" onChange={event=>{if(event.target.value)void act(()=>adminEnrollStudents(course.id,[event.target.value]));event.target.value="";}}><option value="">Enroll approved student…</option>{students.filter(x=>x.status==="active").map(x=><option key={x.id} value={x.id}>{x.full_name}</option>)}</select></article>)}</div><h3 className="admin-subheading">Enrollments</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Student</th><th>Course</th><th>Progress</th><th>Status</th><th>Action</th></tr></thead><tbody>{enrollments.map(e=><tr key={e.id}><td>{e.student_name}</td><td>{e.course_title}</td><td>{e.progress}%</td><td>{e.status}</td><td><button disabled={pending} onClick={()=>void act(()=>adminUpdateEnrollment(e.id,{progress:100,status:"completed",notes:e.notes||""}))}>Mark complete</button>{e.status==="completed"&&<button disabled={pending} onClick={()=>void act(()=>adminGenerateCertificate(e.id))}>Generate certificate</button>}</td></tr>)}</tbody></table></div></>}
    {tab==="certificates"&&<><TemplateUpload pending={pending} act={act}/><div className="admin-ops-grid">{certificates.map(c=><article className="admin-op-card" key={c.id}><span>{c.status}</span><h3>{c.course_title}</h3><code>{c.verification_number}</code><footer>{new Date(c.completion_date).toLocaleDateString()}</footer></article>)}</div></>}
    {tab==="notifications"&&<><NotificationComposer students={students} pending={pending} act={act}/><div className="admin-ops-grid">{campaigns.map(c=><article className={`admin-op-card admin-notification-card priority-${c.priority}`} key={c.id}><div className="admin-notification-tags"><span className={`notification-priority ${c.priority}`}>{c.priority}</span><span>{c.category}</span></div><h3>{c.title}</h3><p>{c.message}</p><footer>{c.read_count}/{c.recipient_count} read</footer></article>)}</div></>}
  </section>;
}

function ApiRequestCard({item,pending,act}:{item:AdminApiRequest;pending:boolean;act:(task:()=>Promise<unknown>)=>Promise<void>}){
  const [productName,setProductName]=useState(item.product_name||"Beyond Marks Foundry Gateway");
  const [deployments,setDeployments]=useState((item.allowed_deployments?.length?item.allowed_deployments:item.requested_deployments||[]).join(", "));
  const [quotaLimit,setQuotaLimit]=useState(String(item.quota_limit||10000));
  const [quotaUnit,setQuotaUnit]=useState<"requests"|"tokens"|"images"|"seconds">(item.quota_unit==="tokens"||item.quota_unit==="images"||item.quota_unit==="seconds"?item.quota_unit:"requests");
  const [expiresAt,setExpiresAt]=useState(item.expires_at?new Date(item.expires_at).toISOString().slice(0,16):new Date(Date.now()+30*86400000).toISOString().slice(0,16));
  const [notes,setNotes]=useState(item.review_notes||"");
  const [topUp,setTopUp]=useState("1000");
  const [usage,setUsage]=useState<ApiUsageDetails|null>(null);
  const [usageLoading,setUsageLoading]=useState(false);
  const requestedAt=new Date(item.created_at).toLocaleString(undefined,{day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"});
  const canProvision=item.status==="pending"||item.status==="approved";
  const allowed=deployments.split(",").map(value=>value.trim()).filter(Boolean);
  const submitProvision=()=>void act(()=>adminReviewApiRequest(item.id,{decision:"approve",productName:productName.trim(),allowedDeployments:allowed,quotaLimit:Number(quotaLimit),quotaUnit,expiresAt:new Date(expiresAt).toISOString(),notes:notes.trim()}));
  const openUsage=async()=>{if(!item.subscription_id)return;setUsageLoading(true);try{setUsage(await adminGetApiUsage(item.subscription_id));}finally{setUsageLoading(false);}};
  const remaining=Math.max(0,(item.quota_limit||0)-(item.usage_count||0));
  return <><article className={`admin-op-card api-request-card status-${item.status}`}>
    <div className="api-request-heading"><span className={`admin-status ${item.status}`}><i/>{item.status}</span><time>{requestedAt}</time></div>
    <h3>{item.full_name}</h3>
    <p className="api-request-identity">{item.academy_id}{item.admission_number&&<><br/>Admission no. {item.admission_number}</>}</p>
    {item.project_name&&<div className="api-request-project"><small>PROJECT · {item.estimated_usage||"starter"} usage</small><strong>{item.project_name}</strong><p>{item.intended_use}</p></div>}
    {!!item.requested_deployments?.length&&<div className="api-deployment-request-list">{item.requested_deployments.map(deployment=><code key={deployment}>{deployment}</code>)}</div>}
    <div className="api-capability-list">{item.capabilities.map(capability=><span key={capability}>{capability}</span>)}</div>
    {item.other_requirements&&<div className="api-request-message"><strong>Student requirements</strong><p>{item.other_requirements}</p></div>}
    {canProvision?<div className="api-review-form">
      {item.status==="approved"&&<div className="api-existing-credential"><strong>Academy gateway active</strong><span>Key ending {item.key_last_four} · {remaining.toLocaleString()} {item.quota_unit} remaining</span><small>The Azure Foundry credential stays hidden on the Academy backend.</small></div>}
      <label><span>Access name</span><input value={productName} onChange={event=>setProductName(event.target.value)} placeholder="Beyond Marks Foundry Gateway"/></label>
      <label><span>Allowed Foundry deployments <small>Comma-separated deployment names</small></span><input value={deployments} onChange={event=>setDeployments(event.target.value)} placeholder="gpt-4.1-mini, text-embedding-3-small"/></label>
      <div className="api-limit-fields"><label><span>Usage limit</span><input type="number" min="1" step="1" value={quotaLimit} onChange={event=>setQuotaLimit(event.target.value)}/></label><label><span>Limit unit</span><select value={quotaUnit} onChange={event=>setQuotaUnit(event.target.value as typeof quotaUnit)}><option value="requests">Requests</option><option value="tokens">Tokens</option><option value="images">Images</option><option value="seconds">Video seconds</option></select></label><label><span>Access expires</span><input type="datetime-local" value={expiresAt} onChange={event=>setExpiresAt(event.target.value)}/></label></div>
      <label><span>Administrator note</span><input value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Approval note or rejection reason"/></label>
      <div className="admin-row-actions api-review-actions"><button className="success" disabled={pending||productName.trim().length<2||!allowed.length||!Number.isSafeInteger(Number(quotaLimit))||Number(quotaLimit)<1||!expiresAt} onClick={submitProvision}>{item.status==="approved"?"Rotate key & renew":"Approve & create gateway key"}</button>{item.status==="pending"&&<button className="danger" disabled={pending||notes.trim().length<3} onClick={()=>void act(()=>adminReviewApiRequest(item.id,{decision:"reject",notes:notes.trim()}))}>Reject request</button>}</div>
      {item.status==="approved"&&item.subscription_id&&<div className="api-lifecycle">
        <div><input type="number" min="1" value={topUp} onChange={event=>setTopUp(event.target.value)} aria-label="Top-up amount"/><button disabled={pending||Number(topUp)<1} onClick={()=>void act(()=>adminManageApiSubscription(item.subscription_id!,{action:"topUp",amount:Number(topUp),notes:"Administrator top-up"}))}>Top up</button></div>
        <button disabled={pending} onClick={()=>{if(window.confirm("Reset recorded usage to zero while keeping the current allowance?"))void act(()=>adminManageApiSubscription(item.subscription_id!,{action:"reset",notes:"Administrator reset"}));}}>Reset usage</button>
        <button disabled={pending} onClick={()=>void act(()=>adminManageApiSubscription(item.subscription_id!,{action:"renew",quotaLimit:Number(quotaLimit),quotaUnit,expiresAt:new Date(expiresAt).toISOString(),notes:"Administrator renewal"}))}>Renew allowance</button>
        <button className="danger" disabled={pending} onClick={()=>{if(window.confirm("Revoke this gateway key immediately?"))void act(()=>adminManageApiSubscription(item.subscription_id!,{action:"revoke",notes:"Administrator revocation"}));}}>Revoke</button>
        <button disabled={usageLoading} onClick={()=>void openUsage()}>{usageLoading?"Loading…":"Exact usage details"}</button>
      </div>}
    </div>:<div className="api-review-summary"><strong>Administrator decision</strong><p>{item.review_notes||"No review note was added."}</p></div>}
  </article>{usage&&<UsageDialog details={usage} student={item.full_name} onClose={()=>setUsage(null)}/>}</>;
}

function ServiceRequestCard({item,pending,act}:{item:AdminServiceRequest;pending:boolean;act:(task:()=>Promise<unknown>)=>Promise<void>}){
  const catalog=AZURE_SERVICE_CATALOG.find(value=>value.type===item.service_type);
  const [displayName,setDisplayName]=useState(item.display_name||`${item.project_name} · ${catalog?.shortName||"Azure Service"}`);
  const [quotaLimit,setQuotaLimit]=useState(String(item.quota_limit||item.requested_quota));
  const [quotaUnit,setQuotaUnit]=useState<AzureQuotaUnit>(item.quota_unit||item.requested_unit);
  const [expiresAt,setExpiresAt]=useState(item.expires_at?new Date(item.expires_at).toISOString().slice(0,16):new Date(Date.now()+30*86400000).toISOString().slice(0,16));
  const [notes,setNotes]=useState(item.review_notes||"");
  const requestedConfiguration=(item.configuration||{}) as Record<string,unknown>;
  const [githubRepository,setGithubRepository]=useState(String(requestedConfiguration.githubRepository||""));
  const [containerImage,setContainerImage]=useState(String(requestedConfiguration.containerImage||""));
  const [topUp,setTopUp]=useState(String(Math.max(1,Math.round((item.quota_limit||item.requested_quota)*.25))));
  const entitlementActive=item.entitlement_status==="active";
  const percent=item.quota_limit?Math.min(100,((item.usage_count||0)/item.quota_limit)*100):0;
  const needsSource=["container_compute","functions","machine_learning"].includes(item.service_type);
  const approve=()=>void act(()=>adminReviewServiceRequest(item.id,{decision:"approve",displayName:displayName.trim(),quotaLimit:Number(quotaLimit),quotaUnit,expiresAt:new Date(expiresAt).toISOString(),resourceConfig:{provisioningMode:"academy_managed",requestedConfiguration:{...item.configuration,githubRepository:githubRepository.trim(),containerImage:containerImage.trim()}},notes:notes.trim()}));
  return <article className={`admin-op-card service-request-admin-card status-${item.status}`}>
    <div className="api-request-heading"><span className={`admin-status ${item.status}`}><i/>{item.status}</span><time>{new Date(item.created_at).toLocaleString()}</time></div>
    <div className="service-admin-title"><span>{catalog?.shortName.slice(0,2).toUpperCase()||"AZ"}</span><div><small>{catalog?.name||item.service_type.replaceAll("_"," ")}</small><h3>{item.project_name}</h3></div></div>
    <p className="api-request-identity">{item.full_name} · {item.academy_id}{item.admission_number&&<><br/>Admission no. {item.admission_number}</>}</p>
    <div className="service-request-spec"><span><small>Plan</small><strong>{item.plan_code}</strong></span><span><small>Requested</small><strong>{formatServiceUnits(item.requested_quota,item.requested_unit)}</strong></span></div>
    <div className="api-request-message"><strong>Student use case</strong><p>{item.use_case}</p></div>
    {(item.status==="pending"||item.status==="approved")?<div className="api-review-form">
      {item.entitlement_id&&<div className="service-admin-allowance"><div><span>Current allowance</span><strong>{formatServiceUnits(item.usage_count||0,item.quota_unit||item.requested_unit)} <small>/ {formatServiceUnits(item.quota_limit||0,item.quota_unit||item.requested_unit)}</small></strong></div><em className={`service-status ${item.entitlement_status}`}>{item.entitlement_status}</em><i><b style={{width:`${percent}%`}}/></i></div>}
      <label><span>Entitlement name</span><input value={displayName} onChange={event=>setDisplayName(event.target.value)}/></label>
      <div className="api-limit-fields"><label><span>Allowance</span><input type="number" min="1" value={quotaLimit} onChange={event=>setQuotaLimit(event.target.value)}/></label><label><span>Unit</span><select value={quotaUnit} onChange={event=>setQuotaUnit(event.target.value as AzureQuotaUnit)} disabled>{["bytes","compute_minutes","gpu_minutes","database_mb","executions","requests","pages","minutes","messages","events","log_mb"].map(unit=><option key={unit} value={unit}>{unit.replaceAll("_"," ")}</option>)}</select></label><label><span>Expires</span><input type="datetime-local" value={expiresAt} onChange={event=>setExpiresAt(event.target.value)}/></label></div>
      {needsSource&&<div className="api-limit-fields"><label><span>Approved GitHub repository</span><input value={githubRepository} onChange={event=>setGithubRepository(event.target.value)} placeholder="https://github.com/organisation/project"/></label><label><span>Approved container image</span><input value={containerImage} onChange={event=>setContainerImage(event.target.value)} placeholder="registry.example.com/project:tag"/></label></div>}
      <label><span>Administrator note</span><input value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Approval details or rejection reason"/></label>
      <div className="admin-row-actions api-review-actions"><button className="success" disabled={pending||displayName.trim().length<2||Number(quotaLimit)<1||!expiresAt||(needsSource&&!githubRepository.trim()&&!containerImage.trim())} onClick={approve}>{item.entitlement_id?"Reprovision & apply allowance":"Approve & provision"}</button>{item.status==="pending"&&<button className="danger" disabled={pending||notes.trim().length<3} onClick={()=>void act(()=>adminReviewServiceRequest(item.id,{decision:"reject",notes:notes.trim()}))}>Reject request</button>}{item.entitlement_id&&item.entitlement_status==="failed"&&<button disabled={pending} onClick={()=>void act(()=>adminRetryServiceProvisioning(item.entitlement_id!))}>Retry provisioning</button>}</div>
      {item.entitlement_id&&<div className="api-lifecycle"><div><input type="number" min="1" value={topUp} onChange={event=>setTopUp(event.target.value)}/><button disabled={pending||Number(topUp)<1||!entitlementActive} onClick={()=>void act(()=>adminManageServiceEntitlement(item.entitlement_id!,{action:"topUp",amount:Number(topUp),notes:"Administrator top-up"}))}>Top up</button></div><button disabled={pending} onClick={()=>void act(()=>adminManageServiceEntitlement(item.entitlement_id!,{action:"reset",notes:"Administrator usage reset"}))}>Reset usage</button><button disabled={pending} onClick={()=>void act(()=>adminManageServiceEntitlement(item.entitlement_id!,{action:entitlementActive?"suspend":"activate",notes:"Administrator lifecycle update"}))}>{entitlementActive?"Suspend":"Activate"}</button><button className="danger" disabled={pending||item.entitlement_status==="revoked"} onClick={()=>{if(window.confirm("Permanently revoke this Azure service allowance?"))void act(()=>adminManageServiceEntitlement(item.entitlement_id!,{action:"revoke",notes:"Administrator revocation"}));}}>Revoke</button></div>}
    </div>:<div className="api-review-summary"><strong>Administrator decision</strong><p>{item.review_notes||"No review note was added."}</p></div>}
  </article>;
}

function UsageDialog({details,student,onClose}:{details:ApiUsageDetails;student:string;onClose:()=>void}){
  return <div className="admin-modal-layer" onMouseDown={onClose}><section className="admin-modal api-usage-modal" role="dialog" aria-modal="true" onMouseDown={event=>event.stopPropagation()}><button className="admin-modal-close" onClick={onClose}>×</button><span>FOUNDRY USAGE LEDGER</span><h2>{student}</h2><p>Exact units reported by successful Azure Foundry responses. Failed calls remain visible with zero charged usage.</p>
    <div className="api-usage-summary"><article><small>Gateway calls</small><strong>{details.totals.request_count.toLocaleString()}</strong></article><article><small>Charged units</small><strong>{details.totals.charged_units.toLocaleString()}</strong></article><article><small>Input tokens</small><strong>{details.totals.input_tokens.toLocaleString()}</strong></article><article><small>Output tokens</small><strong>{details.totals.output_tokens.toLocaleString()}</strong></article></div>
    <div className="api-usage-table"><table><thead><tr><th>Time</th><th>Deployment</th><th>Operation</th><th>Usage</th><th>Status</th><th>Latency</th></tr></thead><tbody>{details.events.map(event=><tr key={event.request_id}><td>{new Date(event.created_at).toLocaleString()}</td><td>{event.deployment}</td><td>{event.operation}</td><td>{event.units_charged.toLocaleString()} {event.quota_unit}{event.total_tokens?` · ${event.input_tokens}/${event.output_tokens} tokens`:""}</td><td className={event.status_code<400?"usage-ok":"usage-failed"}>{event.status_code}</td><td>{event.latency_ms} ms</td></tr>)}{!details.events.length&&<tr><td colSpan={6}>No Foundry calls have been recorded.</td></tr>}</tbody></table></div>
    {!!details.allocations?.length&&<><h3 className="admin-subheading">Allowance history</h3><div className="api-allocation-list">{details.allocations.map(allocation=><article key={allocation.id}><strong>{allocation.action.replace("_"," ")}</strong><span>{allocation.amount.toLocaleString()} {allocation.quota_unit}</span><time>{new Date(allocation.created_at).toLocaleString()}</time></article>)}</div></>}
  </section></div>;
}

function NotificationComposer({students,pending,act}:{students:AdminStudent[];pending:boolean;act:(task:()=>Promise<unknown>)=>Promise<void>}){
  const [audience,setAudience]=useState<"all"|"specific">("specific");
  const [selected,setSelected]=useState<string[]>([]);
  const active=students.filter(student=>student.status==="active");
  const toggle=(id:string)=>setSelected(items=>items.includes(id)?items.filter(item=>item!==id):[...items,id]);
  return <form className="admin-campaign-form notification-composer" onSubmit={event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);void act(()=>adminCreateCampaign({title:String(data.get("title")),message:String(data.get("message")),category:String(data.get("category")),priority:String(data.get("priority")),all:audience==="all",userIds:audience==="specific"?selected:[]}));form.reset();setSelected([]);}}>
    <input name="title" placeholder="Notification title" required/>
    <textarea name="message" placeholder="Write the complete notification message" required/>
    <input name="category" placeholder="Category" defaultValue="Academy update"/>
    <select name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select>
    <div className="notification-audience">
      <strong>Recipients</strong>
      <div className="audience-toggle"><button type="button" className={audience==="specific"?"active":""} onClick={()=>setAudience("specific")}>Specific people</button><button type="button" className={audience==="all"?"active":""} onClick={()=>setAudience("all")}>Everyone</button></div>
      {audience==="specific"&&<div className="recipient-picker">{active.map(student=><label key={student.id}><input type="checkbox" checked={selected.includes(student.id)} onChange={()=>toggle(student.id)}/><span><strong>{student.full_name}</strong><small>{student.academy_id}</small></span></label>)}{!active.length&&<p>No active students available.</p>}</div>}
      <small>{audience==="all"?`All ${active.length} active users will receive this.`:`${selected.length} recipient${selected.length===1?"":"s"} selected.`}</small>
    </div>
    <button disabled={pending||(audience==="specific"&&!selected.length)}>{pending?"Sending…":audience==="all"?"Send to everyone":`Send to ${selected.length||""} selected`}</button>
  </form>;
}

function AdmissionCard({item,pending,act}:{item:AdminAdmission;pending:boolean;act:(task:()=>Promise<unknown>)=>Promise<void>}){
  const [number,setNumber]=useState(item.admission_number||`BM-${new Date().getFullYear()}-`);
  const [reason,setReason]=useState("");
  return <article className="admin-op-card"><span>{item.status.toUpperCase()}</span><h3>{item.full_name}</h3><p>{item.academy_id}<br/>Signup ID: {item.admission_id}</p>{item.status==="pending"&&<><input value={number} onChange={e=>setNumber(e.target.value.toUpperCase())} placeholder="BM-2026-0001"/><div className="admin-row-actions"><button disabled={pending} className="success" onClick={()=>void act(()=>adminReviewAdmission(item.id,{decision:"approve",admissionNumber:number}))}>Approve</button><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Rejection reason"/><button disabled={pending||reason.length<3} className="danger" onClick={()=>void act(()=>adminReviewAdmission(item.id,{decision:"reject",reason}))}>Reject</button></div></>}{item.status==="rejected"&&<button disabled={pending} onClick={()=>void act(()=>adminReviewAdmission(item.id,{decision:"reopen"}))}>Reopen application</button>}</article>;
}

function TemplateUpload({pending,act}:{pending:boolean;act:(task:()=>Promise<unknown>)=>Promise<void>}){
  return <form className="admin-inline-form" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;const data=new FormData(form),file=data.get("template") as File;if(!file?.size)return;const reader=new FileReader();reader.onload=()=>void act(()=>adminUploadCertificateTemplate({name:String(data.get("name")),prompt:String(data.get("prompt")),imageBase64:String(reader.result)}));reader.readAsDataURL(file);}}><input name="name" defaultValue="Beyond Marks Completion Certificate" required/><input name="template" type="file" accept="image/png" required/><input name="prompt" defaultValue="Use the supplied official Beyond Marks certificate template."/><button disabled={pending}>Upload certificate template</button></form>;
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
