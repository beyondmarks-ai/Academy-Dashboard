"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AZURE_SERVICE_CATALOG, formatServiceUnits } from "@/lib/azure-catalog";
import {
  getServiceAccess,
  requestServiceAccess,
  type AzureServiceType,
  type ServiceAccessOverview,
} from "@/lib/academy-api";
import {ServiceExplorer} from "@/components/service-explorer";

const emptyOverview: ServiceAccessOverview = { requests: [], entitlements: [], ledger: { events: [], allocations: [] } };

function ServiceGlyph({ label }: { label: string }) {
  return <span className="azure-service-glyph" aria-hidden="true">{label.split(/\W+/).map(value=>value[0]).join("").slice(0,2)}</span>;
}

function ConsoleIcon({name}:{name:"home"|"catalog"|"usage"|"projects"|"account"|"settings"|"help"}) {
  const paths={
    home:<><path d="m4 10 8-6 8 6v10H4Z"/><path d="M9 20v-6h6v6"/></>,
    catalog:<><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
    usage:<><path d="M5 20V10M12 20V4M19 20v-7"/></>,
    projects:<path d="M3 7h7l2 2h9v11H3Z"/>,
    account:<><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M15 14c3 0 5 2 5 5"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></>,
    help:<><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 4.2 2.3c-1.1.7-1.7 1.2-1.7 2.7M12 18h.01"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function AzureServiceArt({label}:{label:string}) {
  return <div className="azure-service-art" aria-hidden="true">
    <svg viewBox="0 0 280 150" fill="none">
      <defs>
        <linearGradient id="azure-art-blue" x1="40" y1="120" x2="232" y2="22" gradientUnits="userSpaceOnUse"><stop stopColor="#245DFF"/><stop offset="1" stopColor="#64B5FF"/></linearGradient>
        <linearGradient id="azure-art-dark" x1="90" y1="120" x2="190" y2="36" gradientUnits="userSpaceOnUse"><stop stopColor="#0A2A70"/><stop offset="1" stopColor="#286BDA"/></linearGradient>
        <filter id="azure-art-glow"><feGaussianBlur stdDeviation="7"/></filter>
      </defs>
      <ellipse cx="151" cy="123" rx="99" ry="15" fill="#1B5BFF" opacity=".16" filter="url(#azure-art-glow)"/>
      <path d="M177 60c4-21 21-34 42-31 18 2 31 15 33 32 14 2 24 13 24 27 0 16-13 29-30 29h-67c-17 0-30-12-30-28 0-15 12-27 28-29Z" fill="url(#azure-art-blue)" opacity=".9"/>
      <path d="M177 60c4-21 21-34 42-31 18 2 31 15 33 32" stroke="#A5D7FF" strokeWidth="2" opacity=".7"/>
      <g stroke="#69A9FF" strokeWidth="1.2">
        <path d="m54 91 20-11 20 11-20 12Z" fill="url(#azure-art-dark)"/><path d="m54 91 20 12v23L54 114Z" fill="#0D347F"/><path d="m94 91-20 12v23l20-12Z" fill="#1C5AD0"/>
        <path d="m100 76 18-10 18 10-18 11Z" fill="url(#azure-art-blue)"/><path d="m100 76 18 11v21l-18-11Z" fill="#123C91"/><path d="m136 76-18 11v21l18-11Z" fill="#256DE2"/>
        <path d="m112 104 22-12 22 12-22 13Z" fill="url(#azure-art-dark)"/><path d="m112 104 22 13v25l-22-13Z" fill="#0B2E76"/><path d="m156 104-22 13v25l22-13Z" fill="#1D5DCE"/>
      </g>
    </svg>
    <small>{label}</small>
  </div>;
}

export function AzureServiceCenter({ authenticated, onError }: { authenticated: boolean; onError: (message: string) => void }) {
  const [overview,setOverview]=useState<ServiceAccessOverview>(emptyOverview);
  const [open,setOpen]=useState(false);
  const [view,setView]=useState<"catalog"|"ledger">("catalog");
  const [selectedType,setSelectedType]=useState<AzureServiceType>("blob_storage");
  const [selectedPlan,setSelectedPlan]=useState<"explore"|"build"|"scale">("explore");
  const [pending,setPending]=useState(false);
  const [success,setSuccess]=useState("");
  const [explorerId,setExplorerId]=useState<string|null>(null);
  const selected=AZURE_SERVICE_CATALOG.find(item=>item.type===selectedType)!;
  const plan=selected.plans.find(item=>item.code===selectedPlan)!;

  const refresh=async()=>{
    if(!authenticated)return;
    try{setOverview(await getServiceAccess());}
    catch(error){onError(error instanceof Error?error.message:"Azure service access could not be loaded.");}
  };
  useEffect(()=>{void refresh();},[authenticated]);

  const active=overview.entitlements.filter(item=>item.status==="active");
  const provisioning=overview.entitlements.filter(item=>item.status==="provisioning");
  const pendingRequests=overview.requests.filter(item=>item.status==="pending");
  const overallUsage=useMemo(()=>{
    if(!active.length)return 0;
    return Math.round(active.reduce((sum,item)=>sum+Math.min(100,(item.usage_count/item.quota_limit)*100),0)/active.length);
  },[active]);

  const chooseService=(type:AzureServiceType)=>{
    setSelectedType(type);
    setSelectedPlan("explore");
    setSuccess("");
  };

  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const form=event.currentTarget;
    const data=new FormData(form);
    if(!authenticated){onError("Sign in to request Azure service access.");return;}
    setPending(true);setSuccess("");
    try{
      await requestServiceAccess({
        serviceType:selected.type,
        projectName:String(data.get("projectName")||"").trim(),
        planCode:selectedPlan,
        requestedQuota:plan.quota,
        requestedUnit:selected.unit,
        useCase:String(data.get("useCase")||"").trim(),
        configuration:{
          regionPreference:String(data.get("regionPreference")||"academy-default"),
          runtime:String(data.get("runtime")||"managed"),
          githubRepository:String(data.get("githubRepository")||"").trim(),
          containerImage:String(data.get("containerImage")||"").trim(),
        },
      });
      form.reset();
      setSuccess(`${selected.name} request submitted for administrator review.`);
      await refresh();
    }catch(error){onError(error instanceof Error?error.message:"The Azure service request could not be submitted.");}
    finally{setPending(false);}
  };

  return <>
    <section className="azure-services-box" aria-labelledby="azure-services-title">
      <header>
        <div className="azure-services-title"><ServiceGlyph label="Azure"/><div><p>Managed infrastructure</p><h2 id="azure-services-title">Cloud services</h2></div></div>
        <span className="azure-live-indicator"><i/>{provisioning.length?`${provisioning.length} provisioning`:`${active.length} active`}</span>
      </header>
      <div className="azure-service-metrics">
        <article><small>Available</small><strong>{AZURE_SERVICE_CATALOG.length}</strong><span>managed services</span></article>
        <article><small>Pending</small><strong>{pendingRequests.length}</strong><span>admin reviews</span></article>
        <article><small>Usage</small><strong>{overallUsage}%</strong><span>across allowances</span></article>
      </div>
      <div className="azure-service-preview">
        {AZURE_SERVICE_CATALOG.slice(0,4).map(item=>{const entitlement=overview.entitlements.find(value=>value.service_type===item.type&&value.status==="active");return <button key={item.type} type="button" onClick={()=>{if(entitlement)setExplorerId(entitlement.id);else{chooseService(item.type);setView("catalog");setOpen(true);}}}><ServiceGlyph label={item.shortName}/><span><strong>{item.shortName}</strong><small>{entitlement?"Open workspace":overview.requests.some(value=>value.service_type===item.type&&value.status==="pending")?"In review":"Available"}</small></span><i>›</i></button>;})}
      </div>
      <footer><button type="button" onClick={()=>{setView("catalog");setOpen(true);}}>Browse all services</button><button type="button" onClick={()=>{setView("ledger");setOpen(true);}}>Open usage ledger</button></footer>
    </section>

    {open&&<div className="azure-service-modal-layer" onMouseDown={()=>setOpen(false)}>
      <section className="azure-service-modal" role="dialog" aria-modal="true" aria-labelledby="azure-hub-title" onMouseDown={event=>event.stopPropagation()}>
        <button className="azure-service-close" type="button" onClick={()=>setOpen(false)} aria-label="Close Azure services">×</button>
        <header className="azure-console-topbar">
          <div className="azure-console-brand"><span>BM</span><div><strong>Beyond Marks</strong><small>Cloud access</small></div></div>
          <div className="azure-console-search"><ConsoleIcon name="catalog"/><span>Search services and projects</span><kbd>Ctrl K</kbd></div>
          <div className="azure-console-status"><i/><span>Academy managed</span></div>
        </header>
        <div className="azure-console-shell">
          <aside className="azure-console-rail" aria-label="Cloud center navigation">
            <button className="active" type="button" aria-label="Cloud center"><ConsoleIcon name="home"/></button>
            <button type="button" aria-label="Service catalogue" onClick={()=>setView("catalog")}><ConsoleIcon name="catalog"/></button>
            <button type="button" aria-label="Usage ledger" onClick={()=>setView("ledger")}><ConsoleIcon name="usage"/></button>
            <button type="button" aria-label="Projects" disabled><ConsoleIcon name="projects"/></button>
            <button type="button" aria-label="Account" disabled><ConsoleIcon name="account"/></button>
            <button type="button" aria-label="Settings" disabled><ConsoleIcon name="settings"/></button>
            <button type="button" aria-label="Help" disabled><ConsoleIcon name="help"/></button>
          </aside>
          <div className="azure-console-workspace">
            <header className="azure-hub-header"><span>BEYOND MARKS CLOUD ACCESS</span><h2 id="azure-hub-title">Azure Service Center</h2><p>Request governed resources and track every approved allowance from one workspace.</p></header>
            <nav className="azure-hub-tabs"><button className={view==="catalog"?"active":""} onClick={()=>setView("catalog")}>Service catalogue <span>{AZURE_SERVICE_CATALOG.length}</span></button><button className={view==="ledger"?"active":""} onClick={()=>setView("ledger")}>Usage ledger <span>{overview.entitlements.length}</span></button></nav>

        {view==="catalog"?<div className="azure-catalog-layout">
          <aside className="azure-catalog-panel"><span>SERVICE CATALOGUE</span><div className="azure-catalog-list">{AZURE_SERVICE_CATALOG.map(item=>{
            const entitlement=overview.entitlements.find(value=>value.service_type===item.type&&!["revoked","expired"].includes(value.status));
            const request=overview.requests.find(value=>value.service_type===item.type&&value.status==="pending");
            return <button key={item.type} className={selectedType===item.type?"active":""} onClick={()=>chooseService(item.type)}><ServiceGlyph label={item.shortName}/><span><strong>{item.name}</strong><small>{entitlement?`${entitlement.status} allowance`:request?"Awaiting review":item.description}</small></span>{(entitlement||request)&&<em>{entitlement?entitlement.status.toUpperCase():"PENDING"}</em>}</button>;
          })}</div></aside>
          <div className="azure-service-detail">
            <div className="azure-detail-hero">
              <div><div className="azure-detail-heading"><ServiceGlyph label={selected.shortName}/><div><span>MANAGED AZURE SERVICE</span><h3>{selected.name}</h3><p>{selected.description}</p></div></div>
              <div className="azure-feature-row">{selected.features.map(feature=><span key={feature}>✓ {feature}</span>)}</div></div>
              <AzureServiceArt label={selected.shortName}/>
            </div>
            {overview.entitlements.some(item=>item.service_type===selected.type&&item.status==="active")&&<button className="azure-open-workspace" onClick={()=>{const item=overview.entitlements.find(value=>value.service_type===selected.type&&value.status==="active");if(item){setOpen(false);setExplorerId(item.id);}}}>Open {selected.shortName} workspace <span>↗</span></button>}
            <form onSubmit={submit}>
              <div className="azure-config-bar"><ConsoleIcon name="projects"/><strong>Configure {selected.shortName} workspace</strong><span>⌄</span></div>
              <label><span>Project name</span><input name="projectName" minLength={2} maxLength={120} placeholder="Project using this service" required/></label>
              <fieldset><legend>Choose an allowance</legend><div className="azure-plan-grid">{selected.plans.map(item=><button type="button" key={item.code} className={selectedPlan===item.code?"active":""} onClick={()=>setSelectedPlan(item.code)}><i>{selectedPlan===item.code?"✓":"◇"}</i><small>{item.name}</small><strong>{item.label}</strong><span>{item.code==="explore"?"Prototype":item.code==="build"?"Regular projects":"Advanced workloads"}</span></button>)}</div></fieldset>
              <div className="azure-form-grid"><label><span>Region preference</span><select name="regionPreference"><option value="academy-default">Academy managed</option><option value="india">India</option><option value="global">Any available region</option></select></label><label><span>Runtime policy</span><select name="runtime"><option value="managed">Managed & isolated</option><option value="project">Project dedicated</option></select></label></div>
              {["container_compute","functions","machine_learning"].includes(selected.type)&&<div className="azure-form-grid"><label><span>GitHub repository</span><input name="githubRepository" type="url" placeholder="https://github.com/organisation/project"/></label><label><span>Container image <small>Optional alternative</small></span><input name="containerImage" placeholder="registry.example.com/project:tag"/></label></div>}
              <label><span>Project use case</span><textarea name="useCase" minLength={10} maxLength={3000} placeholder="Explain what you will build, the expected workload, and why this service is needed." required/></label>
              {success&&<p className="azure-request-success">{success}</p>}
              <div className="azure-request-footer"><div><small>REQUESTED ALLOWANCE</small><strong>{plan.label}</strong></div><button disabled={pending||overview.requests.some(item=>item.service_type===selected.type&&item.status==="pending")||overview.entitlements.some(item=>item.service_type===selected.type&&!["revoked","expired"].includes(item.status))}>{pending?"Submitting…":overview.entitlements.some(item=>item.service_type===selected.type&&item.status==="provisioning")?"Provisioning…":overview.entitlements.some(item=>item.service_type===selected.type&&item.status==="active")?"Already active":overview.entitlements.some(item=>item.service_type===selected.type&&item.status==="failed")?"Admin action required":overview.requests.some(item=>item.service_type===selected.type&&item.status==="pending")?"Review pending":"Submit access request"}</button></div>
            </form>
          </div>
        </div>:<div className="azure-ledger">
          <div className="azure-ledger-summary"><article><small>Active services</small><strong>{active.length}</strong></article><article><small>Pending reviews</small><strong>{pendingRequests.length}</strong></article><article><small>Usage events</small><strong>{overview.ledger.events.length}</strong></article><article><small>Allowance changes</small><strong>{overview.ledger.allocations.length}</strong></article></div>
          <div className="azure-entitlement-grid">{overview.entitlements.map(item=>{
            const catalog=AZURE_SERVICE_CATALOG.find(value=>value.type===item.service_type);
            const percent=Math.min(100,(item.usage_count/item.quota_limit)*100);
            return <article key={item.id}><header><ServiceGlyph label={catalog?.shortName||item.service_type}/><div><strong>{item.display_name}</strong><small>{catalog?.name}</small></div><span className={`service-status ${item.status}`}>{item.status}</span></header><div className="service-quota-numbers"><strong>{formatServiceUnits(item.usage_count,item.quota_unit)}</strong><span>of {formatServiceUnits(item.quota_limit,item.quota_unit)}</span></div><div className="service-quota-track"><i style={{width:`${percent}%`}}/></div><footer><span>{Math.max(0,item.quota_limit-item.usage_count).toLocaleString()} remaining</span><time>{item.expires_at?`Expires ${new Date(item.expires_at).toLocaleDateString()}`:"No expiry"}</time></footer>{item.status==="active"&&<button className="azure-entitlement-open" onClick={()=>{setOpen(false);setExplorerId(item.id);}}>Open service workspace <span>↗</span></button>}</article>;
          })}{!overview.entitlements.length&&<div className="azure-ledger-empty"><ServiceGlyph label="Ledger"/><strong>No service allowances yet</strong><p>Approved Azure service requests will appear here with an exact, append-only usage history.</p><button onClick={()=>setView("catalog")}>Browse services</button></div>}</div>
          {!!overview.ledger.events.length&&<div className="azure-ledger-table"><header><h3>Recent usage events</h3><span>IMMUTABLE METERING HISTORY</span></header><div><table><thead><tr><th>Time</th><th>Service</th><th>Operation</th><th>Usage</th><th>Status</th></tr></thead><tbody>{overview.ledger.events.map(event=><tr key={event.id}><td>{new Date(event.occurred_at).toLocaleString()}</td><td>{AZURE_SERVICE_CATALOG.find(item=>item.type===event.service_type)?.shortName||event.service_type}</td><td>{event.operation}</td><td>{formatServiceUnits(event.quantity,event.quota_unit)}</td><td><span className={`service-status ${event.status}`}>{event.status}</span></td></tr>)}</tbody></table></div></div>}
          {!!overview.requests.length&&<div className="azure-request-history"><h3>Request history</h3>{overview.requests.map(item=><article key={item.id}><span className={`service-status ${item.status}`}>{item.status}</span><div><strong>{AZURE_SERVICE_CATALOG.find(value=>value.type===item.service_type)?.name||item.service_type}</strong><small>{item.project_name} · {item.plan_code} · {new Date(item.created_at).toLocaleDateString()}</small></div>{item.review_notes&&<p>{item.review_notes}</p>}</article>)}</div>}
        </div>}
          </div>
        </div>
      </section>
    </div>}
    {explorerId&&<ServiceExplorer entitlements={overview.entitlements} initialId={explorerId} onClose={()=>setExplorerId(null)} onChanged={()=>void refresh()}/>}
  </>;
}
