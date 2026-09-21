"use client";

import React, { useState, useEffect, useRef } from 'react';

type Crawler = {
  id: string;
  name: string;
  description: string;
  script: string;
  days: string[];
  time: string;
};

export default function MissionControl() {
  const [crawlers, setCrawlers] = useState<Crawler[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [editingCrawler, setEditingCrawler] = useState<Crawler | null>(null);
  const [runningCrawler, setRunningCrawler] = useState<Crawler | null>(null);
  const [confirmingRun, setConfirmingRun] = useState<Crawler | null>(null);

  // Terminal state
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/crawlers')
      .then(res => res.json())
      .then(data => {
        setCrawlers(data);
        setLoading(false);
      });
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCrawler) return;

    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingCrawler.id,
        days: editingCrawler.days,
        time: editingCrawler.time
      })
    });
    
    if (res.ok) {
      const updated = await res.json();
      setCrawlers(crawlers.map(c => c.id === updated.task.id ? updated.task : c));
      setEditingCrawler(null);
    } else {
      alert("Failed to save schedule.");
    }
  };

  const handleDayToggle = (day: string) => {
    if (!editingCrawler) return;
    const days = editingCrawler.days.includes(day)
      ? editingCrawler.days.filter(d => d !== day)
      : [...editingCrawler.days, day];
    setEditingCrawler({ ...editingCrawler, days });
  };

  const executeCrawler = (crawler: Crawler) => {
    setConfirmingRun(null);
    setRunningCrawler(crawler);
    setTerminalOutput([`Initializing connection to daemon...`]);

    const eventSource = new EventSource(`/api/run?script=${crawler.script}`);
    
    eventSource.onmessage = (event) => {
      if (event.data === '[DONE]') {
        eventSource.close();
      } else {
        setTerminalOutput(prev => [...prev, event.data]);
      }
    };
    
    eventSource.onerror = () => {
      setTerminalOutput(prev => [...prev, 'ERROR: EventSource connection lost.']);
      eventSource.close();
    };
  };

  if (loading) return <div className="container header"><h1>Initializing Mission Control...</h1></div>;

  const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div className="container">
      <header className="header">
        <h1>Mission Control</h1>
        <p>Live Music Search Agent - Master Dashboard</p>
      </header>

      <div className="grid">
        {crawlers.map(crawler => (
          <div key={crawler.id} className="card glass-panel">
            <div className="card-header">
              <h2>{crawler.name}</h2>
              <p>{crawler.description}</p>
              
              <div className="badge-container">
                {crawler.days.map(d => (
                  <span key={d} className="badge">{d}</span>
                ))}
                <span className="badge time-badge">@ {crawler.time}</span>
              </div>
            </div>

            <div className="card-actions">
              <button 
                className="btn-primary" 
                onClick={() => setConfirmingRun(crawler)}
              >
                Run Now
              </button>
              <button 
                className="btn-secondary" 
                onClick={() => setEditingCrawler({...crawler})}
              >
                Edit Schedule
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Confirmation Modal */}
      {confirmingRun && (
        <div className="modal-overlay">
          <div className="modal glass-panel">
            <div className="modal-header">
              <h2>Confirm Execution</h2>
              <button className="modal-close" onClick={() => setConfirmingRun(null)}>&times;</button>
            </div>
            <p style={{marginBottom: '2rem'}}>Are you sure you want to run <strong>{confirmingRun.name}</strong> now?</p>
            <div style={{display: 'flex', gap: '1rem'}}>
              <button className="btn-primary" style={{background: 'var(--danger-color)'}} onClick={() => executeCrawler(confirmingRun)}>Yes, Execute</button>
              <button className="btn-secondary" onClick={() => setConfirmingRun(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Terminal Modal */}
      {runningCrawler && (
        <div className="modal-overlay">
          <div className="modal terminal-modal glass-panel">
            <div className="modal-header">
              <h2>Executing: {runningCrawler.name}</h2>
              <button className="modal-close" onClick={() => setRunningCrawler(null)}>&times;</button>
            </div>
            <div className="terminal-window" ref={terminalRef}>
              {terminalOutput.map((line, i) => {
                let className = 'terminal-line';
                if (line.includes('ERROR')) className += ' error';
                if (line.includes('finished!')) className += ' done';
                return <div key={i} className={className}>{line}</div>;
              })}
            </div>
          </div>
        </div>
      )}

      {/* Edit Schedule Modal */}
      {editingCrawler && (
        <div className="modal-overlay">
          <div className="modal glass-panel">
            <div className="modal-header">
              <h2>Edit Schedule: {editingCrawler.name}</h2>
              <button className="modal-close" onClick={() => setEditingCrawler(null)}>&times;</button>
            </div>
            
            <form onSubmit={handleEditSave}>
              <div className="form-group">
                <label className="form-label">Time (e.g. 09:00AM, 04:00PM)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editingCrawler.time} 
                  onChange={e => setEditingCrawler({...editingCrawler, time: e.target.value})} 
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Days to Run</label>
                <div className="checkbox-grid">
                  {ALL_DAYS.map(day => (
                    <label key={day} className="checkbox-label">
                      <input 
                        type="checkbox" 
                        checked={editingCrawler.days.includes(day)}
                        onChange={() => handleDayToggle(day)}
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{display: 'flex', gap: '1rem', marginTop: '2rem'}}>
                <button type="submit" className="btn-primary">Save Schedule</button>
                <button type="button" className="btn-secondary" onClick={() => setEditingCrawler(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
