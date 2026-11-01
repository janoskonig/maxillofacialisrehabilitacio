interface PatientAppointment {
  id:string;
  startTime:string;
  appointmentStatus?:string|null;
  approvalStatus?:string|null;
}

/** A patient's next visit stays visible even after years of clinical history. */
export function groupPatientAppointments<T extends PatientAppointment>(appointments:T[],now=Date.now()) {
  const upcoming:T[]=[],undocumented:T[]=[],history:T[]=[];
  for(const appointment of appointments){
    const unresolved=!appointment.appointmentStatus&&appointment.approvalStatus!=='rejected';
    const time=Date.parse(appointment.startTime);
    if(unresolved&&time>=now)upcoming.push(appointment);
    else if(unresolved&&Number.isFinite(time))undocumented.push(appointment);
    else history.push(appointment);
  }
  const chronological=(a:T,b:T)=>{
    const first=Date.parse(a.startTime),second=Date.parse(b.startTime);
    if(!Number.isFinite(first))return Number.isFinite(second)?1:a.id.localeCompare(b.id);
    if(!Number.isFinite(second))return -1;
    return first-second||a.id.localeCompare(b.id);
  };
  return {
    upcoming:upcoming.sort(chronological),
    undocumented:undocumented.sort((a,b)=>chronological(b,a)),
    history:history.sort((a,b)=>chronological(b,a)),
  };
}
