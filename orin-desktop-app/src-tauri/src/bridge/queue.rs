//! Background task queue and sub-agents.
//!
//! The design constraint is the one Orin already has: a queued task is not a
//! licence to act unattended. A queued or delegated task may *read* and reason
//! freely, but anything that mutates still goes through the same run-bound,
//! expiring, single-use approval the foreground agent uses. Nothing here can
//! grant one.
//!
//! Pure logic, no Tauri, so every rule below is testable without a window.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    /// Waiting for a slot. Cannot hold an approval.
    Queued,
    /// Running. Read-only work proceeds; mutations pause for approval.
    Running,
    /// Stopped at an approval prompt and waiting for a person.
    AwaitingApproval,
    Done,
    Failed,
    /// Cancelled by the user before it finished.
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTask {
    pub id: String,
    /// A short human label, shown in the queue.
    pub title: String,
    pub instructions: String,
    pub state: TaskState,
    /// True when this task was delegated to a sub-agent.
    pub delegated: bool,
    /// A sub-agent reports here; a top-level task reports to `None`.
    pub parent_id: Option<String>,
    pub created_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
    pub error: Option<String>,
}

/// Why a transition was refused. The UI turns these into an explanation rather
/// than a silent no-op.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    NotFound,
    /// Cannot delegate a task to itself.
    SelfParent,
    /// The parent is no longer running, so its child has nothing to report to.
    ParentGone,
    /// A task that already finished cannot be resumed.
    Terminal,
    /// A task is still holding an approval prompt.
    HeldForApproval,
}

pub struct Queue {
    tasks: VecDeque<BackgroundTask>,
    max_concurrent: usize,
    /// How many *delegated* tasks may run at once. Sub-agents multiply model
    /// calls, so their concurrency is capped separately from top-level work.
    max_delegated: usize,
}

impl Queue {
    pub fn new(max_concurrent: usize, max_delegated: usize) -> Self {
        Self {
            tasks: VecDeque::new(),
            max_concurrent: max_concurrent.max(1),
            max_delegated: max_delegated.max(1),
        }
    }

    pub fn enqueue(
        &mut self,
        id: String,
        title: String,
        instructions: String,
        delegated: bool,
        parent_id: Option<String>,
        now_ms: u64,
    ) -> Result<BackgroundTask, Refusal> {
        if let Some(parent) = &parent_id {
            if parent == &id {
                return Err(Refusal::SelfParent);
            }
            if !self
                .tasks
                .iter()
                .any(|t| &t.id == parent && !t.finished_at_ms.is_some())
            {
                return Err(Refusal::ParentGone);
            }
        }
        if delegated && self.outstanding_delegated() >= self.max_delegated {
            // Counted against *outstanding* delegated work, not just what is
            // running. Otherwise a parent can enqueue fifty sub-agents that
            // each look harmless now and all become "running" later, which is
            // exactly the fan-out the cap exists to stop.
            return Err(Refusal::HeldForApproval);
        }
        let task = BackgroundTask {
            id,
            title,
            instructions,
            state: TaskState::Queued,
            delegated,
            parent_id,
            created_at_ms: now_ms,
            started_at_ms: None,
            finished_at_ms: None,
            error: None,
        };
        self.tasks.push_back(task.clone());
        Ok(task)
    }

    pub fn get(&self, id: &str) -> Option<&BackgroundTask> {
        self.tasks.iter().find(|t| t.id == id)
    }

    pub fn list(&self) -> Vec<BackgroundTask> {
        self.tasks.iter().cloned().collect()
    }

    pub fn running(&self) -> usize {
        self.tasks
            .iter()
            .filter(|t| t.state == TaskState::Running || t.state == TaskState::AwaitingApproval)
            .count()
    }

    /// Delegated work that is queued, running, or waiting on approval.
    pub fn outstanding_delegated(&self) -> usize {
        self.tasks
            .iter()
            .filter(|t| t.delegated && t.finished_at_ms.is_none())
            .count()
    }

    pub fn running_delegated(&self) -> usize {
        self.tasks
            .iter()
            .filter(|t| t.delegated && (t.state == TaskState::Running || t.state == TaskState::AwaitingApproval))
            .count()
    }

    /// Take the next task that may start, if a slot is free.
    pub fn claim_next(&mut self, now_ms: u64) -> Option<BackgroundTask> {
        if self.running() >= self.max_concurrent {
            return None;
        }
        let running_delegated = self.running_delegated();
        let position = self.tasks.iter().position(|t| {
            t.state == TaskState::Queued
                && (!t.delegated || running_delegated < self.max_delegated)
        })?;
        let mut task = self.tasks.remove(position)?;
        task.state = TaskState::Running;
        task.started_at_ms = Some(now_ms);
        self.tasks.push_back(task.clone());
        Some(task)
    }

    /// A task reached an approval prompt. It stops, and it counts as running.
    pub fn hold_for_approval(&mut self, id: &str) -> Result<(), Refusal> {
        match self.tasks.iter_mut().find(|t| t.id == id) {
            Some(task) if task.finished_at_ms.is_none() => {
                task.state = TaskState::AwaitingApproval;
                Ok(())
            }
            Some(_) => Err(Refusal::Terminal),
            None => Err(Refusal::NotFound),
        }
    }

    /// The user answered. Resuming is allowed; a finished task is not.
    pub fn resume(&mut self, id: &str) -> Result<(), Refusal> {
        match self.tasks.iter_mut().find(|t| t.id == id) {
            Some(task) if task.finished_at_ms.is_none() => {
                if task.state == TaskState::AwaitingApproval {
                    task.state = TaskState::Running;
                }
                Ok(())
            }
            Some(_) => Err(Refusal::Terminal),
            None => Err(Refusal::NotFound),
        }
    }

    pub fn finish(&mut self, id: &str, error: Option<String>, now_ms: u64) -> Result<(), Refusal> {
        match self.tasks.iter_mut().find(|t| t.id == id) {
            Some(task) if task.finished_at_ms.is_none() => {
                task.state = if error.is_some() { TaskState::Failed } else { TaskState::Done };
                task.finished_at_ms = Some(now_ms);
                task.error = error;
                Ok(())
            }
            Some(_) => Err(Refusal::Terminal),
            None => Err(Refusal::NotFound),
        }
    }

    /// Cancel, and cancel everything it delegated. A child must not outlive
    /// the parent whose approval chain was carrying it.
    pub fn cancel(&mut self, id: &str, now_ms: u64) -> Result<Vec<String>, Refusal> {
        if self.get(id).is_none() {
            return Err(Refusal::NotFound);
        }
        let mut cancelled = vec![id.to_string()];
        let mut frontier = vec![id.to_string()];
        while let Some(current) = frontier.pop() {
            for task in self.tasks.iter_mut() {
                if task.parent_id.as_deref() == Some(current.as_str()) && task.finished_at_ms.is_none() {
                    task.state = TaskState::Cancelled;
                    task.finished_at_ms = Some(now_ms);
                    cancelled.push(task.id.clone());
                    frontier.push(task.id.clone());
                }
            }
        }
        if let Some(task) = self.tasks.iter_mut().find(|t| t.id == id) {
            if task.finished_at_ms.is_none() {
                task.state = TaskState::Cancelled;
                task.finished_at_ms = Some(now_ms);
            }
        }
        Ok(cancelled)
    }

    /// Drop finished tasks older than `keep_ms`, so a long session does not
    /// accumulate an unbounded list of history the user cannot act on.
    pub fn prune(&mut self, now_ms: u64, keep_ms: u64) -> usize {
        let before = self.tasks.len();
        self.tasks.retain(|t| match t.finished_at_ms {
            Some(finished) => now_ms.saturating_sub(finished) < keep_ms,
            None => true,
        });
        before - self.tasks.len()
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

fn queue_state<'a>(state: &'a tauri::State<'a, super::AppState>) -> &'a std::sync::Mutex<Queue> {
    state
        .background_queue
        .get_or_init(|| std::sync::Mutex::new(Queue::new(2, 2)))
}

fn refusal_message(reason: Refusal) -> String {
    match reason {
        Refusal::NotFound => "That task is no longer in the queue.".into(),
        Refusal::SelfParent => "A task cannot delegate to itself.".into(),
        Refusal::ParentGone => "The task that would own this one has finished.".into(),
        Refusal::Terminal => "That task has already finished.".into(),
        Refusal::HeldForApproval => "Too many sub-agents are already outstanding.".into(),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn queue_list(state: tauri::State<'_, super::AppState>) -> Result<Vec<BackgroundTask>, String> {
    let guard = queue_state(&state).lock().map_err(|_| "queue lock poisoned".to_string())?;
    Ok(guard.list())
}

#[tauri::command]
pub fn queue_enqueue(
    id: String,
    title: String,
    instructions: String,
    delegated: bool,
    parent_id: Option<String>,
    state: tauri::State<'_, super::AppState>,
) -> Result<BackgroundTask, String> {
    let mut guard = queue_state(&state).lock().map_err(|_| "queue lock poisoned".to_string())?;
    guard
        .enqueue(id, title, instructions, delegated, parent_id, now_ms())
        .map_err(refusal_message)
}

#[tauri::command]
pub fn queue_cancel(id: String, state: tauri::State<'_, super::AppState>) -> Result<Vec<String>, String> {
    let mut guard = queue_state(&state).lock().map_err(|_| "queue lock poisoned".to_string())?;
    guard.cancel(&id, now_ms()).map_err(refusal_message)
}

#[tauri::command]
pub fn queue_finish(
    id: String,
    error: Option<String>,
    state: tauri::State<'_, super::AppState>,
) -> Result<(), String> {
    let mut guard = queue_state(&state).lock().map_err(|_| "queue lock poisoned".to_string())?;
    guard.finish(&id, error, now_ms()).map_err(refusal_message)
}

#[tauri::command]
pub fn queue_hold(
    id: String,
    state: tauri::State<'_, super::AppState>,
) -> Result<(), String> {
    let mut guard = queue_state(&state).lock().map_err(|_| "queue lock poisoned".to_string())?;
    guard.hold_for_approval(&id).map_err(refusal_message)
}

#[tauri::command]
pub fn queue_resume(id: String, state: tauri::State<'_, super::AppState>) -> Result<(), String> {
    let mut guard = queue_state(&state).lock().map_err(|_| "queue lock poisoned".to_string())?;
    guard.resume(&id).map_err(refusal_message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue() -> Queue {
        Queue::new(2, 1)
    }

    fn enqueue(q: &mut Queue, id: &str, delegated: bool, parent: Option<&str>) -> Result<(), Refusal> {
        q.enqueue(
            id.to_string(),
            format!("task {id}"),
            "do the thing".into(),
            delegated,
            parent.map(str::to_string),
            1_000,
        )
        .map(|_| ())
    }

    #[test]
    fn a_task_starts_queued_and_claims_a_slot() {
        let mut q = queue();
        enqueue(&mut q, "a", false, None).unwrap();
        assert_eq!(q.get("a").unwrap().state, TaskState::Queued);

        let claimed = q.claim_next(2_000).unwrap();
        assert_eq!(claimed.id, "a");
        assert_eq!(claimed.state, TaskState::Running);
        assert_eq!(claimed.started_at_ms, Some(2_000));
        assert!(q.claim_next(2_100).is_none(), "no work left");
    }

    #[test]
    fn concurrency_is_capped() {
        let mut q = queue(); // 2 concurrent
        enqueue(&mut q, "a", false, None).unwrap();
        enqueue(&mut q, "b", false, None).unwrap();
        enqueue(&mut q, "c", false, None).unwrap();
        assert!(q.claim_next(1).is_some());
        assert!(q.claim_next(1).is_some());
        assert!(q.claim_next(1).is_none(), "the third must wait");
        assert_eq!(q.running(), 2);
    }

    #[test]
    fn a_task_holding_an_approval_still_occupies_its_slot() {
        // A prompt is not free capacity: the run is still open and still
        // able to resume into a mutation.
        let mut q = queue();
        enqueue(&mut q, "a", false, None).unwrap();
        q.claim_next(1);
        q.hold_for_approval("a").unwrap();
        assert_eq!(q.get("a").unwrap().state, TaskState::AwaitingApproval);
        assert_eq!(q.running(), 1, "a held task still counts as running");
    }

    #[test]
    fn a_sub_agent_cannot_delegate_to_itself() {
        let mut q = queue();
        enqueue(&mut q, "p", false, None).unwrap();
        assert_eq!(enqueue(&mut q, "p", true, Some("p")), Err(Refusal::SelfParent));
    }

    #[test]
    fn a_sub_agent_cannot_outlive_its_parent() {
        let mut q = queue();
        enqueue(&mut q, "p", false, None).unwrap();
        q.claim_next(1);
        // While the parent is alive, a child is fine.
        assert!(enqueue(&mut q, "c", true, Some("p")).is_ok());
        q.finish("p", None, 2_000).unwrap();
        // Once it is gone, there is nothing to report to.
        assert_eq!(enqueue(&mut q, "c2", true, Some("p")), Err(Refusal::ParentGone));
    }

    #[test]
    fn delegated_concurrency_is_capped_separately() {
        let mut q = queue(); // 2 overall, 1 delegated
        enqueue(&mut q, "p", false, None).unwrap();
        q.claim_next(1);
        assert!(enqueue(&mut q, "c1", true, Some("p")).is_ok());
        // The cap on delegation is its own limit, not the overall one.
        assert_eq!(enqueue(&mut q, "c2", true, Some("p")), Err(Refusal::HeldForApproval));
    }

    #[test]
    fn cancelling_a_parent_cancels_everything_it_delegated() {
        // Room for two children, so what is under test is the cascade rather
        // than the delegation cap.
        let mut q = Queue::new(4, 2);
        enqueue(&mut q, "p", false, None).unwrap();
        q.claim_next(1);
        enqueue(&mut q, "c1", true, Some("p")).unwrap();
        enqueue(&mut q, "c2", true, Some("p")).unwrap();

        let cancelled = q.cancel("p", 5_000).unwrap();
        assert_eq!(cancelled.len(), 3, "the parent and both children");
        for id in ["p", "c1", "c2"] {
            assert_eq!(q.get(id).unwrap().state, TaskState::Cancelled, "{id}");
        }
    }

    #[test]
    fn a_finished_task_cannot_be_resumed_or_finished_twice() {
        let mut q = queue();
        enqueue(&mut q, "a", false, None).unwrap();
        q.claim_next(1);
        q.finish("a", None, 2).unwrap();
        assert_eq!(q.finish("a", None, 3), Err(Refusal::Terminal));
        assert_eq!(q.resume("a"), Err(Refusal::Terminal));
    }

    #[test]
    fn a_failure_is_recorded_not_swallowed() {
        let mut q = queue();
        enqueue(&mut q, "a", false, None).unwrap();
        q.claim_next(1);
        q.finish("a", Some("provider 503".into()), 2).unwrap();
        let task = q.get("a").unwrap();
        assert_eq!(task.state, TaskState::Failed);
        assert_eq!(task.error.as_deref(), Some("provider 503"));
        assert_eq!(task.finished_at_ms, Some(2));
    }

    #[test]
    fn unknown_ids_are_refused_rather_than_created() {
        let mut q = queue();
        assert_eq!(q.finish("nope", None, 1), Err(Refusal::NotFound));
        assert_eq!(q.hold_for_approval("nope"), Err(Refusal::NotFound));
        assert_eq!(q.resume("nope"), Err(Refusal::NotFound));
        assert_eq!(q.cancel("nope", 1), Err(Refusal::NotFound));
    }

    #[test]
    fn pruning_keeps_live_work_and_drops_old_history() {
        let mut q = queue();
        enqueue(&mut q, "old", false, None).unwrap();
        q.claim_next(1);
        q.finish("old", None, 1_000).unwrap();
        enqueue(&mut q, "live", false, None).unwrap();

        let dropped = q.prune(1_000 + 60_000, 30_000);
        assert_eq!(dropped, 1);
        assert!(q.get("old").is_none());
        assert!(q.get("live").is_some(), "unfinished work is never pruned");
    }

    #[test]
    fn the_queue_never_claims_a_finished_task() {
        let mut q = Queue::new(4, 2);
        enqueue(&mut q, "a", false, None).unwrap();
        q.finish("a", Some("boom".into()), 1).unwrap();
        // A queued-then-failed task must not be picked up again.
        assert!(q.claim_next(2).is_none());
    }
}
