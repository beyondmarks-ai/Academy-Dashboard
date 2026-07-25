"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { AdminDashboard } from "@/components/admin-dashboard";
import {
  createProject as createApiProject,
  getApiAccess,
  getNotifications,
  getProfile,
  getProject as getApiProject,
  getProjects,
  getMyCertificates,
  getMyCourses,
  markAllNotificationsRead,
  markNotificationRead,
  requestApiAccess,
  revealApiCredential,
  type AcademyNotification,
  type AcademyProject,
  type AcademySubscription,
  type AcademyCertificate,
  type AdminEnrollment,
} from "@/lib/academy-api";
import { beginAdminMfaSetup, loginWithAcademyId, logoutAcademyAccount, signupWithAcademyId, verifyAdminMfa, type MfaChallenge } from "@/lib/academy-auth";

type AuthMode = "login" | "signup" | null;
type NotificationItem = { id: number | string; title: string; message: string; fullMessage: string; time: string; category: string; priority: "normal" | "important" | "urgent"; unread: boolean };
type ProjectItem = { id: number | string; name: string; description: string; status: "working" | "finished"; githubUrl: string; readme: string; updated: string };

function projectFromApi(project: AcademyProject): ProjectItem {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    githubUrl: project.github_url || "",
    readme: project.readme || `# ${project.name}\n\nOpen this project to load its README.md.`,
    updated: new Date(project.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
  };
}

function notificationFromApi(notification: AcademyNotification): NotificationItem {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    fullMessage: notification.message,
    category: notification.category,
    priority: notification.priority || "normal",
    unread: notification.unread,
    time: new Date(notification.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
  };
}

export default function Dashboard() {
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [adminSignIn, setAdminSignIn] = useState(false);
  const [openingMode, setOpeningMode] = useState<AuthMode>(null);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [userName, setUserName] = useState("Student");
  const [userRole, setUserRole] = useState<"student" | "admin" | "developer">("student");
  const [authenticated, setAuthenticated] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [mfaChallenge,setMfaChallenge]=useState<MfaChallenge|null>(null);
  const [mfaSetup,setMfaSetup]=useState<{qrDataUrl:string;manualKey:string}|null>(null);
  const [recoveryCodes,setRecoveryCodes]=useState<string[]>([]);
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginAuth = (mode: Exclude<AuthMode, null>, forAdmin = false) => {
    if (openingMode) return;
    setAdminSignIn(mode === "login" && forAdmin);
    setAuthError("");
    setOpeningMode(mode);
    const animationDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1850;
    openingTimer.current = setTimeout(() => {
      setAuthMode(mode);
      setOpeningMode(null);
    }, animationDelay);
  };

  const closeAuth = () => {
    if (openingTimer.current) clearTimeout(openingTimer.current);
    openingTimer.current = null;
    setOpeningMode(null);
    setAuthMode(null);
    setAdminSignIn(false);
    setMfaChallenge(null);setMfaSetup(null);setRecoveryCodes([]);
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setAuthPending(true);
    setAuthError("");
    try {
      const academyId = String(formData.get("academyId") || "").trim();
      const password = String(formData.get("password") || "");
      if (authMode === "signup" && password !== String(formData.get("confirmPassword") || "")) {
        throw new Error("Passwords do not match.");
      }
      const result = authMode === "signup"
        ? await signupWithAcademyId({
            fullName: String(formData.get("name") || "").trim(),
            academyId,
            admissionId: String(formData.get("admissionId") || "").trim(),
            password,
          })
        : await loginWithAcademyId(academyId, password);
      if(result&&"mfa" in result){
        setMfaChallenge(result.mfa);
        if(result.mfa.setupRequired)setMfaSetup(await beginAdminMfaSetup(result.mfa.challengeToken));
        return;
      }
      const profile=result;
      if (profile?.status === "pending") {
        setAuthError("Registration submitted successfully. An Academy administrator must approve your account before you can sign in.");
        return;
      }
      setUserName(profile?.full_name || profile?.username || "Student");
      setUserRole(profile?.role === "admin" ? "admin" : profile?.role === "developer" ? "developer" : "student");
      setAuthenticated(true);
      closeAuth();
      setDashboardReady(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Secure sign-in could not be completed.");
    } finally {
      setAuthPending(false);
    }
  };

  const enterDashboard = () => {
    if (openingMode || authMode) return;
    setUserName("Student");
    setUserRole("student");
    setDashboardReady(true);
  };

  const leaveDashboard = async () => {
    if (authenticated) {
      try { await logoutAcademyAccount(); } catch { /* The local session is cleared by expiry if Azure is unavailable. */ }
    }
    setAuthenticated(false);
    setDashboardReady(false);
    setUserName("Student");
  };

  useEffect(() => {
    let active = true;
    getProfile()
      .then((profile) => {
        if (!active) return;
        setUserName(profile.full_name || profile.username || "Student");
        setUserRole(profile.role);
        setAuthenticated(true);
        setDashboardReady(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAuth();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (openingTimer.current) clearTimeout(openingTimer.current);
    };
  }, []);

  const authActive = Boolean(openingMode || authMode);

  if (dashboardReady) {
    if (authenticated && userRole === "admin") {
      return <AdminDashboard adminName={userName} onSignOut={leaveDashboard} />;
    }
    return <DashboardDestination userName={userName} authenticated={authenticated} onSignOut={leaveDashboard} />;
  }

  return (
    <main className={`empty-dashboard ${authActive ? "auth-open" : ""}`}>
      <div className="ambient-bg" />
      <div className={`watermark ${openingMode ? "ring-drawing" : ""} ${authMode ? "color-revealed" : ""}`} aria-hidden="true">
        <Image
          src="/beyond-marks-logo.jpeg"
          alt=""
          fill
          priority
          sizes="(max-width: 760px) 80vw, 520px"
        />
        <svg className="watermark-ring" viewBox="0 0 100 100" focusable="false">
          <defs>
            <linearGradient id="gold-ring-gradient" x1="4" y1="50" x2="96" y2="50" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#9a692f" />
              <stop offset=".36" stopColor="#f8dda2" />
              <stop offset=".58" stopColor="#c58c3c" />
              <stop offset=".78" stopColor="#f4ce83" />
              <stop offset="1" stopColor="#8b5b27" />
            </linearGradient>
          </defs>
          <circle className="ring-halo" cx="50" cy="50" r="48.5" pathLength="1" />
          <circle className="ring-stroke" cx="50" cy="50" r="48.5" pathLength="1" />
        </svg>
      </div>

      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="welcome-ornament" aria-hidden="true"><span /><i /><span /></div>
        <p>Welcome to</p>
        <h1 id="welcome-title">Beyond Marks</h1>
        <div className="welcome-rule" aria-hidden="true"><i /></div>
        <span className="welcome-tagline">LEARN &nbsp;•&nbsp; GROW &nbsp;•&nbsp; GO BEYOND</span>
      </section>

      <footer className="auth-footer">
        <button type="button" className="skip-button" disabled={Boolean(openingMode)} onClick={enterDashboard}>Skip for now</button>
        <button type="button" className="login-button" disabled={Boolean(openingMode)} onClick={() => beginAuth("login")}>Log in</button>
        <button type="button" className="signup-button" disabled={Boolean(openingMode)} onClick={() => beginAuth("signup")}>Sign up</button>
        <button type="button" className="admin-signin-button" disabled={Boolean(openingMode)} onClick={() => beginAuth("login", true)}>
          <span aria-hidden="true">◆</span> Admin sign in
        </button>
      </footer>

      {authMode && (
        <div className="auth-modal-layer" role="presentation" onMouseDown={closeAuth}>
          <div className="auth-modal-frame" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-mascot" aria-hidden="true">
              <Image src="/space-boy-developer.svg" alt="" fill sizes="150px" />
            </div>
            <section
              className="auth-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="auth-title"
            >
            <button className="modal-close" type="button" aria-label="Close" onClick={closeAuth}>×</button>
            <span className="modal-kicker">{adminSignIn ? "ACADEMY ADMINISTRATION" : "BEYOND MARKS AI ACADEMY"}</span>
            <h2 id="auth-title">{adminSignIn ? "Administrator sign in" : authMode === "login" ? "Welcome back" : "Begin your journey"}</h2>
            <p>{adminSignIn ? "Sign in to the single protected Academy administrator account." : authMode === "login" ? "Enter your Beyond Marks Academy ID to continue." : "Create your private Academy account with a valid Admission ID."}</p>

            {mfaChallenge ? <form className="mfa-form" onSubmit={async event=>{
              event.preventDefault();setAuthPending(true);setAuthError("");
              try{const data=new FormData(event.currentTarget);const verified=await verifyAdminMfa(mfaChallenge.challengeToken,String(data.get("code")||""));setUserName(verified.profile.full_name);setUserRole("admin");if(verified.recoveryCodes?.length){setRecoveryCodes(verified.recoveryCodes);return;}setAuthenticated(true);closeAuth();setDashboardReady(true);}catch(error){setAuthError(error instanceof Error?error.message:"Authenticator verification failed.");}finally{setAuthPending(false);}
            }}>
              {recoveryCodes.length?<div className="mfa-recovery"><strong>Save your recovery codes</strong><p>Each code works once. Store them somewhere private before continuing.</p><div>{recoveryCodes.map(code=><code key={code}>{code}</code>)}</div><button className="modal-submit" type="button" onClick={()=>{setRecoveryCodes([]);setAuthenticated(true);setUserRole("admin");closeAuth();setDashboardReady(true);}}>I saved these codes</button></div>:<>
                {mfaSetup?<><p className="mfa-instruction">Scan this QR code using Google Authenticator, Microsoft Authenticator, or Authy.</p><img className="mfa-qr" src={mfaSetup.qrDataUrl} alt="Authenticator setup QR code"/><details><summary>Can’t scan the QR?</summary><code>{mfaSetup.manualKey}</code></details></>:<p className="mfa-instruction">Enter the current six-digit code from your authenticator app.</p>}
                <label><span>Authenticator code</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}|[A-Fa-f0-9-]{13}" placeholder="000000" required autoFocus/></label>
                {authError&&<p className="auth-form-error" role="alert">{authError}</p>}
                <button className="modal-submit" disabled={authPending}>{authPending?"Verifying…":mfaSetup?"Verify & activate MFA":"Verify & sign in"}</button>
              </>}
            </form>:<>
            <form onSubmit={handleAuthSubmit}>
              {authMode === "signup" && (
                <>
                  <label>
                    <span>Full name</span>
                    <input type="text" name="name" placeholder="Your full name" autoComplete="name" autoFocus required />
                  </label>
                  <label>
                    <span>Admission ID</span>
                    <input type="text" name="admissionId" placeholder="Enter your admission ID" autoComplete="off" required />
                  </label>
                </>
              )}
              {authMode === "login" ? (
                <label>
                  <span>Academy ID</span>
                  <input type="text" name="academyId" placeholder="student@beyondmarks.ai" autoComplete="username" inputMode="email" defaultValue={adminSignIn ? "admin@beyondmarks.ai" : ""} readOnly={adminSignIn} required autoFocus />
                </label>
              ) : (
                <label>
                  <span>Choose your Academy ID</span>
                  <input type="text" name="academyId" placeholder="student@beyondmarks.ai" autoComplete="username" inputMode="email" required />
                </label>
              )}
              <label>
                <span>Password</span>
                <input type="password" name="password" placeholder="At least 12 characters" autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={authMode === "signup" ? 12 : 1} maxLength={128} required />
              </label>
              {authMode === "signup" && (
                <label>
                  <span>Confirm password</span>
                  <input type="password" name="confirmPassword" placeholder="Enter the password again" autoComplete="new-password" minLength={12} maxLength={128} required />
                </label>
              )}
              <p className="auth-security-note">Your Academy ID is a private login name, not an email mailbox. No confirmation email is required.</p>
              {authError && <p className="auth-form-error" role="alert">{authError}</p>}
              <button className="modal-submit" type="submit" disabled={authPending}>{authPending ? "Securing your session…" : authMode === "login" ? "Log in securely" : "Create Academy account"}</button>
            </form>

            <div className="modal-switch">
              {authMode === "login" ? "New to Beyond Marks?" : "Already have an account?"}
              <button type="button" onClick={() => {
                setAdminSignIn(false);
                setAuthError("");
                setAuthMode(authMode === "login" ? "signup" : "login");
              }}>
                {authMode === "login" ? "Sign up" : "Log in"}
              </button>
            </div>
            </>}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

function DashboardDestination({ userName, authenticated, onSignOut }: { userName: string; authenticated: boolean; onSignOut: () => void }) {
  const [myCourses,setMyCourses]=useState<AdminEnrollment[]>([]);
  const [myCertificates,setMyCertificates]=useState<AcademyCertificate[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeItem, setActiveItem] = useState("Overview");
  const [activeApiOption, setActiveApiOption] = useState<"request" | "accessed" | null>(null);
  const [apiRequestOpen, setApiRequestOpen] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [revealedApiKey, setRevealedApiKey] = useState("");
  const [apiKeyPending, setApiKeyPending] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [apiSubscription, setApiSubscription] = useState<AcademySubscription | null>(null);
  const [selectedApiModels, setSelectedApiModels] = useState<string[]>([]);
  const [customApiRequirement, setCustomApiRequirement] = useState("");
  const [projectFilter, setProjectFilter] = useState<"working" | "finished">("working");
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([
    {
      id: 1,
      name: "Beyond Marks Dashboard",
      description: "The academy learning and developer-access workspace.",
      status: "working",
      githubUrl: "",
      updated: "Updated today",
      readme: `# Beyond Marks Dashboard

A premium learning and AI developer-access dashboard for Beyond Marks AI Academy.

## Currently building

- Secure learner authentication
- API model access requests
- Project and notification workspace
- Responsive navy-and-gold interface

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

## Status

This project is currently under active development.`,
    },
    {
      id: 2,
      name: "Academy Welcome Experience",
      description: "Animated authentication and branded welcome experience.",
      status: "finished",
      githubUrl: "",
      updated: "Completed recently",
      readme: `# Academy Welcome Experience

The finished welcome experience introduces learners to Beyond Marks AI Academy.

## Features

- Animated academy welcome heading
- Interactive navy-and-gold watermark
- Login and signup workflows
- Responsive presentation

## Project status

Finished and ready for integration.`,
    },
  ]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    { id: 1, title: "Dashboard updated", message: "Your learning space is ready.", fullMessage: "Your Beyond Marks learning dashboard has been successfully updated and is ready to use. New learning tools, course progress information, upcoming schedules, and important academy updates will appear here as they become available.", time: "Just now", category: "Platform update", priority: "normal", unread: true },
    { id: 2, title: "Account connected", message: `Signed in as ${userName}.`, fullMessage: `Your learner account has been connected successfully. You are currently signed in as ${userName}. If you do not recognize this activity, please contact the academy administrator and update your password immediately.`, time: "Today", category: "Account alert", priority: "important", unread: true },
  ]);
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    Promise.all([getProjects(), getNotifications(), getApiAccess(),getMyCourses(),getMyCertificates()])
      .then(([projectData, notificationData, apiAccess,courseData,certificateData]) => {
        if (!active) return;
        setProjects(projectData.map(projectFromApi));
        setNotifications(notificationData.data.map(notificationFromApi));
        setApiSubscription(apiAccess.subscriptions[0] || null);
        setMyCourses(courseData);setMyCertificates(certificateData);
        setSyncError("");
      })
      .catch((error) => {
        if (active) setSyncError(error instanceof Error ? error.message : "Dashboard data could not be synchronized.");
      });
    return () => { active = false; };
  }, [authenticated]);

  const openProject = async (project: ProjectItem) => {
    setSelectedProject(project);
    if (!authenticated || typeof project.id !== "string") return;
    try {
      setSelectedProject(projectFromApi(await getApiProject(project.id)));
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "The project README could not be loaded.");
    }
  };

  const closeApiKeyModal = () => {
    setApiKeyModalOpen(false);
    setApiKeyVisible(false);
    setRevealedApiKey("");
    setApiKeyError("");
    setApiKeyCopied(false);
  };

  const toggleApiKeyVisibility = async () => {
    if (apiKeyVisible) {
      setApiKeyVisible(false);
      setRevealedApiKey("");
      return;
    }
    if (!authenticated) {
      setRevealedApiKey("bm-demo-credential-4479");
      setApiKeyVisible(true);
      return;
    }
    if (!apiSubscription) {
      setApiKeyError("No active API credential has been issued yet.");
      return;
    }
    setApiKeyPending(true);
    setApiKeyError("");
    try {
      setRevealedApiKey(await revealApiCredential(apiSubscription.id));
      setApiKeyVisible(true);
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "The credential could not be revealed.");
    } finally {
      setApiKeyPending(false);
    }
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        setSelectedNotification(null);
        setApiRequestOpen(false);
        setApiKeyModalOpen(false);
        setApiKeyVisible(false);
        setRevealedApiKey("");
        setProjectComposerOpen(false);
        setSelectedProject(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const menuItems = ["Overview", "My Courses", "Performance", "Schedule", "Settings"];

  return (
    <section className={`dashboard-screen ${sidebarOpen ? "sidebar-is-open" : ""}`}>
      <div className="dashboard-destination-bg" />
      {syncError && <div className="dashboard-sync-error" role="status">{syncError}</div>}
      <button
        className={`hamburger-button ${sidebarOpen ? "is-open" : ""}`}
        type="button"
        aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={sidebarOpen}
        aria-controls="dashboard-sidebar"
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <span /><span /><span />
      </button>

      <aside id="dashboard-sidebar" className={`dashboard-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-hidden={!sidebarOpen}>
        <div className="sidebar-branding">
          <span><Image src="/beyond-marks-logo.jpeg" alt="Beyond Marks" fill sizes="48px" /></span>
          <div><strong>Beyond Marks</strong><small>AI Academy</small></div>
        </div>
        <p className="sidebar-section-label">LEARNING SPACE</p>
        <nav aria-label="Dashboard navigation">
          {menuItems.map((item) => {
            const comingSoon = item !== "Overview";
            return (
            <button
              type="button"
              key={item}
              className={`${activeItem === item ? "active" : ""} ${comingSoon ? "coming-soon" : ""}`}
              disabled={comingSoon}
              aria-disabled={comingSoon}
              title={comingSoon ? `${item} — coming soon` : undefined}
              onClick={() => { if (!comingSoon) { setActiveItem(item); setSidebarOpen(false); } }}
            >
              <SidebarIcon name={item} />
              <span>{item}</span>
              {comingSoon && <em>Coming soon</em>}
              <i aria-hidden="true">›</i>
            </button>
          )})}
        </nav>
        <div className="sidebar-account">
          <span>{userName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{userName}</strong><small>Learner account</small></div>
        </div>
        <button className="sidebar-signout" type="button" onClick={onSignOut}>{authenticated ? "Log out" : "Return to welcome"}</button>
      </aside>

      {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <div className="dashboard-left-stack">
      <section className="learner-academics-box">
        <div className="projects-heading"><div><p>ACADEMY PROGRESS</p><h2>My Courses & Certificates</h2></div></div>
        <div className="learner-course-list">{myCourses.length?myCourses.map(course=><article key={course.id}><div><strong>{course.course_title||course.title}</strong><small>{course.status}</small></div><span>{course.progress}%</span><i><b style={{width:`${course.progress}%`}}/></i></article>):<p>No course enrollments yet.</p>}</div>
        <div className="learner-certificate-list">{myCertificates.map(certificate=><a key={certificate.id} href={`/api/academy/v1/certificates/${certificate.id}/download`}><span>Certificate</span><strong>{certificate.course_title}</strong><small>{certificate.verification_number}</small></a>)}</div>
      </section>
      <section className="api-access-box" aria-labelledby="api-access-title">
        <div className="api-access-heading">
          <span className="api-access-icon" aria-hidden="true"><ApiKeyIcon type="key" /></span>
          <div><p>DEVELOPER TOOLS</p><h2 id="api-access-title">API Access</h2></div>
        </div>
        <div className="api-option-list">
          <button type="button" className={activeApiOption === "request" ? "active" : ""} onClick={() => { setActiveApiOption("request"); setApiRequestOpen(true); }}>
            <span><ApiKeyIcon type="plus" /></span>
            <div><strong>Request API Key</strong><small>Submit a new access request</small></div>
            <i>›</i>
          </button>
          <button type="button" className={activeApiOption === "accessed" ? "active" : ""} onClick={() => { setActiveApiOption("accessed"); setApiKeyVisible(false); setRevealedApiKey(""); setApiKeyError(""); setApiKeyCopied(false); setApiKeyModalOpen(true); }}>
            <span><ApiKeyIcon type="shield" /></span>
            <div><strong>Accessed API Key</strong><small>View your approved key</small></div>
            <i>›</i>
          </button>
        </div>
        <p className="api-option-status">
          {activeApiOption === "request" && "Request option selected. Complete verification to continue."}
          {activeApiOption === "accessed" && "Your approved key is encrypted and ready to use."}
          {!activeApiOption && "Select an option to manage API access."}
        </p>
      </section>

      <section className="projects-box" aria-labelledby="projects-title">
        <div className="projects-heading">
          <div><p>PROJECT WORKSPACE</p><h2 id="projects-title">My Projects</h2></div>
          <button type="button" onClick={() => setProjectComposerOpen(true)}><span>+</span> Add</button>
        </div>
        <div className="project-filter" role="tablist" aria-label="Filter projects">
          <button type="button" role="tab" aria-selected={projectFilter === "working"} className={projectFilter === "working" ? "active" : ""} onClick={() => setProjectFilter("working")}>
            Working <span>{projects.filter((project) => project.status === "working").length}</span>
          </button>
          <button type="button" role="tab" aria-selected={projectFilter === "finished"} className={projectFilter === "finished" ? "active" : ""} onClick={() => setProjectFilter("finished")}>
            Finished <span>{projects.filter((project) => project.status === "finished").length}</span>
          </button>
        </div>
        <div className="project-list">
          {projects.filter((project) => project.status === projectFilter).map((project) => (
            <article key={project.id} className="project-card" tabIndex={0} role="button" onClick={() => void openProject(project)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void openProject(project); }}>
              <div className="project-card-topline">
                <span className={`project-status-dot ${project.status}`} />
                <small>{project.status === "working" ? "Currently working on" : "Finished project"}</small>
                <time>{project.updated}</time>
              </div>
              <h3>{project.name}</h3>
              <p>{project.description}</p>
              <div className="project-actions">
                {project.githubUrl ? (
                  <a href={project.githubUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><GithubIcon /> GitHub</a>
                ) : (
                  <button type="button" disabled title="Add a GitHub URL to enable this link"><GithubIcon /> Not linked</button>
                )}
                <button type="button" onClick={(event) => { event.stopPropagation(); void openProject(project); }}><ReadmeIcon /> README.md</button>
              </div>
            </article>
          ))}
        </div>
      </section>
      </div>

      {apiKeyModalOpen && (
        <div className="api-key-modal-layer" role="presentation" onMouseDown={closeApiKeyModal}>
          <section className="api-key-modal" role="dialog" aria-modal="true" aria-labelledby="accessed-key-name" onMouseDown={(event) => event.stopPropagation()}>
            <button className="project-modal-close" type="button" aria-label="Close accessed API key" onClick={closeApiKeyModal}>×</button>
            <span className="api-key-modal-kicker">SECURE DEVELOPER ACCESS</span>
            <h2>Accessed API key</h2>
            <p>View and manage your approved model credential.</p>
            <article className="accessed-key-card">
              <div className="accessed-key-topline">
                <span className="accessed-key-provider" aria-hidden="true">{apiSubscription?.provider?.slice(0, 2).toUpperCase() || "AI"}</span>
                <div>
                  <strong id="accessed-key-name">{apiSubscription?.product_name || (authenticated ? "No approved API key" : "Demo API credential")}</strong>
                  <small><i /> {apiSubscription?.status || (authenticated ? "No access" : "Demo mode")}</small>
                </div>
              </div>
              <div className="accessed-key-value">
                <code aria-label={apiKeyVisible ? "Visible API key" : "Hidden API key"}>
                  {apiKeyVisible
                    ? revealedApiKey
                    : `•••• •••• •••• ${apiSubscription?.key_last_four || (authenticated ? "—" : "4479")}`}
                </code>
                <button
                  type="button"
                  aria-label={apiKeyVisible ? "Hide API key" : "Show API key"}
                  aria-pressed={apiKeyVisible}
                  title={apiKeyVisible ? "Hide API key" : "Show API key"}
                  disabled={apiKeyPending}
                  onClick={() => void toggleApiKeyVisibility()}
                >
                  <VisibilityIcon hidden={apiKeyVisible} />
                </button>
                <button type="button" className="api-key-copy" disabled={!revealedApiKey} onClick={() => { void navigator.clipboard.writeText(revealedApiKey).then(()=>{setApiKeyCopied(true);window.setTimeout(()=>setApiKeyCopied(false),1800);}).catch(()=>setApiKeyError("Copy failed. Select the key and copy it manually.")); }}>{apiKeyCopied?"Copied":"Copy"}</button>
              </div>
              {apiKeyError&&<p className="api-key-error" role="alert">{apiKeyError}</p>}
              <div className="accessed-key-meta">
                <span>{apiSubscription ? `Created ${new Date(apiSubscription.created_at).toLocaleDateString()}` : authenticated ? "Awaiting approval" : "Demo only"}</span>
                <span>{apiSubscription?.credential_available ? "Encrypted credential ready" : "Awaiting provisioning"}</span>
              </div>
              {apiSubscription&&<div className="api-quota-panel">
                <div className="api-quota-heading"><div><small>ASSIGNED USAGE LIMIT</small><strong>{apiSubscription.quota_limit?.toLocaleString()||"Unlimited"} <span>{apiSubscription.quota_unit}</span></strong></div><span className={apiSubscription.expires_at&&new Date(apiSubscription.expires_at)<=new Date()?"expired":"active"}>{apiSubscription.expires_at&&new Date(apiSubscription.expires_at)<=new Date()?"Expired":"Active"}</span></div>
                <div className="api-quota-track"><i style={{width:`${apiSubscription.quota_limit?Math.min(100,(apiSubscription.usage_count/apiSubscription.quota_limit)*100):0}%`}}/></div>
                <div className="api-quota-meta"><span>{apiSubscription.usage_count.toLocaleString()} recorded usage</span><span>{apiSubscription.expires_at?`Expires ${new Date(apiSubscription.expires_at).toLocaleString()}`:"No expiry"}</span></div>
                <p>Usage is enforced only when this credential is routed through an Academy gateway or configured with the same quota at the provider.</p>
              </div>}
            </article>
            <div className="api-key-security-note"><ApiKeyIcon type="shield" /><p><strong>Encrypted and owner-only</strong><span>The full key is encrypted at rest, revealed only on request, and removed from this page when the modal closes.</span></p></div>
            <button className="api-key-modal-done" type="button" onClick={closeApiKeyModal}>Done</button>
          </section>
        </div>
      )}

      {projectComposerOpen && (
        <div className="project-modal-layer" role="presentation" onMouseDown={() => setProjectComposerOpen(false)}>
          <section className="project-composer" role="dialog" aria-modal="true" aria-labelledby="project-composer-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="project-modal-close" type="button" aria-label="Close add project" onClick={() => setProjectComposerOpen(false)}>×</button>
            <span className="project-modal-kicker">PROJECT WORKSPACE</span>
            <h2 id="project-composer-title">Add a project</h2>
            <p>Connect its repository and upload the README.md file shown to your team.</p>
            <form onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const status = String(data.get("projectStatus")) as "working" | "finished";
              const readmeFile = data.get("readmeFile");
              if (!(readmeFile instanceof File) || !readmeFile.name.toLowerCase().endsWith(".md")) return;
              const input = {
                name: String(data.get("projectName") || "Untitled project").trim(),
                description: String(data.get("projectDescription") || "No description provided.").trim(),
                status,
                githubUrl: String(data.get("githubUrl") || "").trim(),
                readme: (await readmeFile.text()).trim() || "# Untitled project\n\nREADME details coming soon.",
              };
              let project: ProjectItem;
              try {
                project = authenticated
                  ? projectFromApi({ ...(await createApiProject(input)), readme: input.readme })
                  : { id: Date.now(), ...input, updated: status === "finished" ? "Completed just now" : "Added just now" };
                setSyncError("");
              } catch (error) {
                setSyncError(error instanceof Error ? error.message : "The project could not be saved.");
                return;
              }
              setProjects((items) => [project, ...items]);
              setProjectFilter(status);
              setProjectComposerOpen(false);
            }}>
              <div className="project-form-grid">
                <label><span>Project name</span><input name="projectName" type="text" placeholder="My AI project" required autoFocus /></label>
                <fieldset className="project-status-field">
                  <legend>Status</legend>
                  <div className="project-status-options">
                    <label>
                      <input type="radio" name="projectStatus" value="working" defaultChecked />
                      <span><i /> Working</span>
                    </label>
                    <label>
                      <input type="radio" name="projectStatus" value="finished" />
                      <span><i /> Finished</span>
                    </label>
                  </div>
                </fieldset>
              </div>
              <label><span>Description</span><input name="projectDescription" type="text" placeholder="A short project summary" required /></label>
              <label><span>GitHub repository <small>Optional</small></span><input name="githubUrl" type="url" placeholder="https://github.com/username/project" /></label>
              <label className="readme-upload-field">
                <span>Upload README.md <small>Markdown file only</small></span>
                <input name="readmeFile" type="file" accept=".md,text/markdown,text/plain" required />
              </label>
              <button className="project-save-button" type="submit">Add project</button>
            </form>
          </section>
        </div>
      )}

      {selectedProject && (
        <div className="project-modal-layer" role="presentation" onMouseDown={() => setSelectedProject(null)}>
          <section className="readme-modal" role="dialog" aria-modal="true" aria-labelledby="readme-project-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="readme-header">
              <div className="readme-file-icon"><ReadmeIcon /></div>
              <div><small>{selectedProject.name}</small><h2 id="readme-project-title">README.md</h2></div>
              <div className="readme-header-actions">
                {selectedProject.githubUrl && <a href={selectedProject.githubUrl} target="_blank" rel="noreferrer"><GithubIcon /> Open repository</a>}
                <button className="project-modal-close" type="button" aria-label="Close README" onClick={() => setSelectedProject(null)}>×</button>
              </div>
            </header>
            <ReadmeDocument content={selectedProject.readme} repositoryUrl={selectedProject.githubUrl} />
          </section>
        </div>
      )}

      {apiRequestOpen && (
        <div className="api-request-modal-layer" role="presentation" onMouseDown={() => setApiRequestOpen(false)}>
          <section className="api-request-modal" role="dialog" aria-modal="true" aria-labelledby="api-request-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="api-request-close" aria-label="Close API request" onClick={() => setApiRequestOpen(false)}>×</button>
            <span className="api-request-kicker">DEVELOPER ACCESS</span>
            <h2 id="api-request-title">Request an API key</h2>
            <p>Select every model capability your project needs. Access is reviewed according to academy policy.</p>
            <form onSubmit={async (event) => {
              event.preventDefault();
              if (authenticated) {
                try {
                  await requestApiAccess(selectedApiModels, customApiRequirement);
                  setSyncError("");
                } catch (error) {
                  setSyncError(error instanceof Error ? error.message : "The API access request could not be submitted.");
                  return;
                }
              }
              setApiRequestOpen(false);
            }}>
              <fieldset>
                <legend>Model access</legend>
                <div className="model-access-grid">
                  {[
                    ["Azure AI Foundry", "/model-icons/azure-foundry.png", "Hosted model catalog"],
                    ["Text & Language", "/model-icons/text-language.png", "Chat and reasoning models"],
                    ["Image Models", "/model-icons/image-models.png", "Generate and edit images"],
                    ["Video Models", "/model-icons/video-models.png", "Create and transform video"],
                    ["Speech & Audio", "/model-icons/speech-audio.png", "Speech, voice and transcription"],
                    ["Embedding Models", "/model-icons/embeddings.png", "Search and retrieval vectors"],
                    ["Realtime Models", "/model-icons/realtime.png", "Low-latency interactions"],
                    ["Safety Models", "/model-icons/safety.png", "Moderation and safeguards"],
                  ].map(([name, icon, description]) => {
                    const selected = selectedApiModels.includes(name);
                    return (
                      <button
                        type="button"
                        className={selected ? "selected" : ""}
                        aria-pressed={selected}
                        key={name}
                        onClick={() => setSelectedApiModels((models) => selected ? models.filter((model) => model !== name) : [...models, name])}
                      >
                        <span className="model-category-icon" aria-hidden="true">
                          <Image src={icon} alt="" width={52} height={52} />
                        </span>
                        <div><strong>{name}</strong><small>{description}</small></div>
                        <i>{selected ? "✓" : "+"}</i>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <label className="custom-api-field">
                <span>Other requirements <small>Optional</small></span>
                <textarea value={customApiRequirement} onChange={(event) => setCustomApiRequirement(event.target.value)} placeholder="Describe another model, provider, usage requirement, expected volume, or integration..." rows={4} />
              </label>
              <div className="api-request-summary">
                <span>{selectedApiModels.length}</span>
                <p><strong>Capabilities selected</strong><small>{selectedApiModels.length ? selectedApiModels.join(" • ") : "Choose at least one model category"}</small></p>
              </div>
              <button className="api-request-submit" type="submit" disabled={!selectedApiModels.length}>Submit API key request</button>
            </form>
          </section>
        </div>
      )}

      <section className="notification-box" aria-labelledby="notification-title">
        <div className="notification-heading">
          <div className="notification-title-wrap">
            <div className="notification-illustration" aria-hidden="true">
              <Image src="/ringing-bell-loop.svg" alt="" fill sizes="60px" />
            </div>
            <div><h2 id="notification-title">Notifications</h2><p><i /> LIVE UPDATES</p></div>
          </div>
          <span className="notification-count">{notifications.filter((item) => item.unread).length}</span>
        </div>
        <div className="notification-list">
          {notifications.map((notification) => (
            <button
              type="button"
              className={`notification-card priority-${notification.priority} ${notification.unread ? "unread" : ""}`}
              key={notification.id}
              onClick={() => {
                setSelectedNotification(notification);
                setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, unread: false } : item));
                if (authenticated && typeof notification.id === "string") {
                  void markNotificationRead(notification.id).catch((error) => setSyncError(error instanceof Error ? error.message : "The notification could not be updated."));
                }
              }}
            >
              <span className="notification-dot" />
              <div><span className={`notification-priority ${notification.priority}`}>{notification.priority}</span><strong>{notification.title}</strong><p>{notification.message}</p><time>{notification.time}</time></div>
              <span className="notification-open-label">Read</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mark-read-button"
          disabled={!notifications.some((item) => item.unread)}
          onClick={() => {
            setNotifications((items) => items.map((item) => ({ ...item, unread: false })));
            if (authenticated) void markAllNotificationsRead().catch((error) => setSyncError(error instanceof Error ? error.message : "Notifications could not be updated."));
          }}
        >
          {notifications.some((item) => item.unread) ? "Mark all as read" : "All caught up"}
        </button>
      </section>

      {selectedNotification && (
        <div className="notification-modal-layer" role="presentation" onMouseDown={() => setSelectedNotification(null)}>
          <section className={`notification-modal priority-${selectedNotification.priority}`} role="dialog" aria-modal="true" aria-labelledby="notification-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="notification-modal-close" aria-label="Close notification" onClick={() => setSelectedNotification(null)}>×</button>
            <div className="notification-modal-icon" aria-hidden="true">
              <Image src="/ringing-bell-loop.svg" alt="" fill sizes="58px" />
            </div>
            <div className="notification-modal-tags"><span className={`notification-priority ${selectedNotification.priority}`}>{selectedNotification.priority}</span><span className="notification-modal-category">{selectedNotification.category}</span></div>
            <h2 id="notification-modal-title">{selectedNotification.title}</h2>
            <time>{selectedNotification.time}</time>
            <div className="notification-modal-rule" />
            <p>{selectedNotification.fullMessage}</p>
            <button type="button" className="notification-modal-done" onClick={() => setSelectedNotification(null)}>Done reading</button>
          </section>
        </div>
      )}

      <div className="dashboard-watermark" aria-hidden="true">
        <Image
          src="/beyond-marks-logo.jpeg"
          alt=""
          fill
          priority
          sizes="(max-width: 760px) 80vw, 460px"
        />
      </div>
      <section className="dashboard-welcome" aria-labelledby="dashboard-welcome-title">
        <div className="dashboard-welcome-mark" aria-hidden="true"><i /><span /><i /></div>
        <p>YOUR LEARNING SPACE</p>
        <h1 id="dashboard-welcome-title">Welcome, <span>{userName}</span>!</h1>
        <div className="dashboard-welcome-rule" aria-hidden="true" />
      </section>
    </section>
  );
}

function SidebarIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    "Overview": <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    "My Courses": <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></>,
    "Performance": <><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/></>,
    "Schedule": <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></>,
    "Settings": <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ApiKeyIcon({ type }: { type: "key" | "plus" | "shield" }) {
  const paths = {
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M15 8l2 2M17 6l2 2"/></>,
    plus: <><circle cx="9" cy="14" r="4"/><path d="m12 11 7-7M16 7l2 2M5 5v5M2.5 7.5h5"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.8 3 8.4 7 10 4-1.6 7-5.2 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}

function VisibilityIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.7" />
      {hidden && <path d="m4 4 16 16" />}
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.2-.36 6.5-1.57 6.5-7A5.5 5.5 0 0 0 19 3.7 5.1 5.1 0 0 0 18.85 0S17.7-.37 15 1.45a13.4 13.4 0 0 0-6 0C6.3-.37 5.15 0 5.15 0A5.1 5.1 0 0 0 5 3.7a5.5 5.5 0 0 0-1.5 3.82c0 5.42 3.3 6.63 6.5 7A4.8 4.8 0 0 0 9 18v4" />
      <path d="M9 19c-3 .92-3-1.5-4.2-2" />
    </svg>
  );
}

function ReadmeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /><path d="M8 7h8M8 11h6" />
    </svg>
  );
}

function ReadmeDocument({ content, repositoryUrl }: { content: string; repositoryUrl: string }) {
  const [defaultBranch, setDefaultBranch] = useState("main");
  const repository = repositoryUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
  const owner = repository?.[1] || "";
  const repo = (repository?.[2] || "").replace(/\.git$/i, "");

  useEffect(() => {
    if (!owner || !repo) return;
    const branchInUrl = repositoryUrl.match(/\/tree\/([^/?#]+)/i)?.[1];
    if (branchInUrl) {
      setDefaultBranch(decodeURIComponent(branchInUrl));
      return;
    }
    let cancelled = false;
    fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((details: { default_branch?: string }) => {
        if (!cancelled && details.default_branch) setDefaultBranch(details.default_branch);
      })
      .catch(() => {
        if (!cancelled) setDefaultBranch("main");
      });
    return () => { cancelled = true; };
  }, [owner, repo, repositoryUrl]);

  const cleanRepositoryPath = (source: string) => {
    const pieces = source.replace(/^\.\//, "").replace(/^\//, "").split("/");
    const normalized: string[] = [];
    pieces.forEach((piece) => {
      if (!piece || piece === ".") return;
      if (piece === "..") normalized.pop();
      else normalized.push(piece);
    });
    return normalized.map((part) => encodeURIComponent(decodeURIComponent(part))).join("/");
  };

  const resolveImageSource = (source?: string) => {
    if (!source || /^(data:|blob:)/i.test(source)) return source;
    const githubBlob = source.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)(?:\?raw=true)?$/i);
    if (githubBlob) {
      return `https://raw.githubusercontent.com/${githubBlob[1]}/${githubBlob[2].replace(/\.git$/i, "")}/${githubBlob[3]}/${cleanRepositoryPath(githubBlob[4])}`;
    }
    if (/^https?:/i.test(source)) return source;
    if (!owner || !repo) return source;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(defaultBranch)}/${cleanRepositoryPath(source)}`;
  };

  const resolveLinkHref = (href?: string) => {
    if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) return href;
    if (!owner || !repo) return href;
    return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(defaultBranch)}/${cleanRepositoryPath(href)}`;
  };

  return (
    <article className="readme-document">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          img: ({ src, alt, title, width, height }) => (
            <img
              src={resolveImageSource(typeof src === "string" ? src : undefined)}
              alt={alt || "README illustration"}
              title={title}
              width={width}
              height={height}
              loading="lazy"
            />
          ),
          a: ({ href, children }) => <a href={resolveLinkHref(href)} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
