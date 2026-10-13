//! Bounded pitch-only relay for a paired phone. No microphone audio is accepted.
use serde_json::{json, Value};
use std::{collections::VecDeque, time::{SystemTime, UNIX_EPOCH}};
pub fn now() -> f64 {SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64()*1000.0}
#[derive(Default)]
pub struct Microphone {state:Value,published:f64,peer:String,received:f64,sequence:Option<u64>,frames:VecDeque<Value>}
impl Microphone {
    pub fn configure(&mut self,body:Value)->Result<Value,String> {
        if let Some(session)=body["session"].as_str() {
            uuid::Uuid::parse_str(session).map_err(|_|"Sessão de microfone inválida.")?;
            if body["epoch"].as_u64().is_none_or(|n|n>=1<<53) {return Err("Sessão de microfone inválida.".into());}
        } else if !body["session"].is_null() {return Err("Sessão inválida.".into());}
        if self.state["session"]!=body["session"] || self.state["epoch"]!=body["epoch"] {self.frames.clear();}
        if self.state["session"]!=body["session"] {self.peer.clear();self.received=0.0;self.sequence=None;}
        self.state=json!({"session":body["session"],"epoch":body["epoch"].as_u64().unwrap_or(0),"active":body["session"].is_string()&&body["active"]==true,"title":body["title"].as_str().unwrap_or_default().chars().take(200).collect::<String>()});
        self.published=now();Ok(json!({"ok":true}))
    }
    pub fn status(&self)->Value {let mut state=self.state.clone();if !state.is_object(){state=json!({});}state["active"]=json!(self.state["active"]==true && now()-self.published<3000.0);state["serverTime"]=json!(now());state}
    pub fn receive(&mut self,body:Value)->Result<Value,String> {
        let clock=now();let sender=body["sender"].as_str().unwrap_or_default();
        uuid::Uuid::parse_str(sender).map_err(|_|"Celular inválido.")?;
        if self.state["active"]!=true || clock-self.published>=3000.0 || body["session"]!=self.state["session"] || body["epoch"]!=self.state["epoch"] {return Err("Ative Celular conectado na pontuação do aparelho principal.".into());}
        if !self.peer.is_empty()&&self.peer!=sender&&clock-self.received<3000.0 {return Err("Outro celular já está usando este microfone.".into());}
        if body["leave"]==true {if self.peer==sender{self.peer.clear();self.received=0.0;}return Ok(json!({"ok":true,"serverTime":clock}));}
        let sequence=body["sequence"].as_u64().filter(|n|*n<1<<53).ok_or("Pacote inválido.")?;
        if self.peer==sender&&self.sequence.is_some_and(|old|sequence<=old){return Ok(json!({"ok":true,"serverTime":clock}));}
        let mut frame=None;
        if !body["frequency"].is_null() {
            let frequency=body["frequency"].as_f64().ok_or("Afinação inválida.")?;
            let confidence=body["confidence"].as_f64().ok_or("Confiança inválida.")?;
            let rms=body["rms"].as_f64().ok_or("Nível inválido.")?;
            let captured=body["capturedAt"].as_f64().ok_or("Tempo inválido.")?;
            if (frequency!=0.0&&!(65.0..=1000.0).contains(&frequency)) || !(0.0..=1.0).contains(&confidence) || !(0.0..=1.0).contains(&rms) || !(clock-1500.0..=clock+250.0).contains(&captured) {return Err("Pacote atrasado ou afinação fora do intervalo.".into());}
            frame=Some(json!({"session":self.state["session"],"epoch":self.state["epoch"],"frequency":frequency,"confidence":confidence,"rms":rms,"capturedAt":captured}));
        }
        self.peer=sender.to_owned();self.sequence=Some(sequence);self.received=clock;
        if let Some(frame)=frame{self.frames.push_back(frame);while self.frames.len()>64{self.frames.pop_front();}}
        Ok(json!({"ok":true,"serverTime":clock}))
    }
    pub fn drain(&mut self)->Value {json!({"frames":self.frames.drain(..).collect::<Vec<_>>(),"ready":!self.peer.is_empty()&&now()-self.received<3000.0})}
}
