import Image from "next/image";

export const dynamic = "force-dynamic";

export default async function VerifyCertificate({params}:{params:Promise<{number:string}>}){
  const {number}=await params;
  const base=(process.env.ACADEMY_API_BASE_URL||process.env.NEXT_PUBLIC_API_BASE_URL||"").replace(/\/$/,"");
  let certificate:null|{verification_number:string;student_name:string;course_title:string;completion_date:string;issued_at:string;status:"issued"|"revoked"}=null;
  if(base){
    const response=await fetch(`${base}/api/v1/certificates/verify/${encodeURIComponent(number)}`,{cache:"no-store"});
    if(response.ok)certificate=(await response.json()).data;
  }
  return <main className="verify-screen">
    <section className="verify-card">
      <div className="verify-logo"><Image src="/beyond-marks-logo.jpeg" alt="Beyond Marks AI Academy" fill sizes="90px"/></div>
      <span>BEYOND MARKS AI ACADEMY</span>
      <h1>Certificate verification</h1>
      {!certificate?<div className="verify-invalid"><strong>Certificate not found</strong><p>The verification number is invalid or the certificate has not been issued.</p></div>:<>
        <div className={`verify-state ${certificate.status}`}><i/>{certificate.status==="issued"?"Authentic certificate":"Certificate revoked"}</div>
        <dl><div><dt>Recipient</dt><dd>{certificate.student_name}</dd></div><div><dt>Course</dt><dd>{certificate.course_title}</dd></div><div><dt>Completion date</dt><dd>{new Date(certificate.completion_date).toLocaleDateString()}</dd></div><div><dt>Verification number</dt><dd><code>{certificate.verification_number}</code></dd></div></dl>
      </>}
    </section>
  </main>;
}
