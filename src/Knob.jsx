import React, { useRef, useState, useEffect } from 'react';

// Draggable Rotary Knob component matching cream glassmorphism styles
export default function Knob({
  label,
  value = 0.5,
  min = 0,
  max = 1,
  defaultValue = 0.5,
  onChange,
  onMidiLearn,
  isLearning = false,
  midiCc = null,
  onMidiUnbind,
  valueDisplayFormatter = (v) => v.toFixed(2),
  tooltip = "Drag vertically to adjust. Double-click to reset.",
  isAutomated = false,
  onClearAutomation = null,
}) {
  const knobRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startVal = useRef(0);
  const [isHovered, setIsHovered] = useState(false);

  // Convert current value (min-max) to normalized 0-1
  const normalizedValue = (value - min) / (max - min);

  // Knob rotation angle (270 degrees total sweep, from -135 to +135)
  const minAngle = -135;
  const maxAngle = 135;
  const currentAngle = minAngle + normalizedValue * (maxAngle - minAngle);

  // Drag handlers
  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    startY.current = e.clientY;
    startVal.current = value;
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    const deltaY = startY.current - e.clientY; // Upward drag increases value
    const dragSpeed = 0.005; // Adjust responsiveness
    const deltaVal = deltaY * dragSpeed * (max - min);
    
    let newVal = startVal.current + deltaVal;
    newVal = Math.max(min, Math.min(max, newVal));
    
    if (onChange) {
      onChange(newVal);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Double click resets to default
  const handleDoubleClick = () => {
    if (onChange) {
      onChange(defaultValue);
    }
  };

  // Prevent memory leaks
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div 
      className="knob-wrapper"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={tooltip}
    >
      {/* Knob Label with Motion indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem', width: '100%' }}>
        <span className="knob-label">{label}</span>
        {isAutomated && onClearAutomation && (
          <span 
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Clear recorded automation for ${label}?`)) {
                onClearAutomation();
              }
            }}
            style={{
              background: 'var(--accent-orange, #e06c43)',
              color: 'white',
              borderRadius: '4px',
              padding: '0px 3px',
              fontSize: '8px',
              fontWeight: '800',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              userSelect: 'none',
              fontFamily: 'var(--font-mono)'
            }}
            title="Motion recorded. Click to clear this automation loop."
          >
            M
          </span>
        )}
      </div>

      {/* Interactive Knob Graphic */}
      <div 
        ref={knobRef}
        className="rotary-knob"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        style={{
          transform: isDragging ? 'scale(1.05)' : 'scale(1)',
          transition: isDragging ? 'none' : 'transform 0.15s ease'
        }}
      >
        {/* MIDI Learn Glow Halos */}
        {isLearning && <div className="knob-learn-indicator active" />}
        
        <svg width="34" height="34" viewBox="0 0 34 34" style={{ display: 'block' }}>
          {/* Dial Background Circle */}
          <circle 
            cx="17" 
            cy="17" 
            r="14" 
            fill="#ffffff" 
            stroke="rgba(0,0,0,0.1)" 
            strokeWidth="1.5" 
            style={{
              filter: 'drop-shadow(0px 1px 3px rgba(0,0,0,0.06))'
            }}
          />
          
          {/* Tone Ring Indicator (Active Value Arc) */}
          <circle 
            cx="17" 
            cy="17" 
            r="11" 
            fill="none" 
            stroke={midiCc !== null ? "var(--accent-learn)" : "var(--accent-orange)"} 
            strokeWidth="2.5"
            strokeDasharray={`${2 * Math.PI * 11}`}
            strokeDashoffset={`${2 * Math.PI * 11 * (1 - (normalizedValue * 0.75))}`} // 75% sweep
            transform="rotate(135 17 17)"
            strokeLinecap="round"
            style={{
              opacity: 0.85,
              transition: isDragging ? 'none' : 'stroke-dashoffset 0.1s ease'
            }}
          />

          {/* Core Dial Cover cap */}
          <circle 
            cx="17" 
            cy="17" 
            r="8" 
            fill="#f7f6f0" 
            stroke="rgba(0,0,0,0.04)"
            strokeWidth="0.5"
          />

          {/* Pointer tick line rotating */}
          <line 
            x1="17" 
            y1="17" 
            x2="17" 
            y2="7" 
            stroke="#2b2927" 
            strokeWidth="2.5" 
            strokeLinecap="round"
            transform={`rotate(${currentAngle} 17 17)`}
            style={{
              transition: isDragging ? 'none' : 'transform 0.1s ease'
            }}
          />
        </svg>
      </div>

      {/* Value Readout / CC Mapping Badge */}
      <span 
        style={{ 
          fontSize: '0.6rem', 
          fontFamily: 'var(--font-mono)', 
          color: midiCc !== null ? 'var(--accent-learn)' : 'var(--text-secondary)',
          minHeight: '12px',
          fontWeight: midiCc !== null ? '600' : '400',
        }}
      >
        {isHovered && midiCc !== null ? (
          <span 
            onClick={onMidiUnbind} 
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
            title="Click to unbind CC"
          >
            CC {midiCc} ⨉
          </span>
        ) : (
          midiCc !== null ? `CC ${midiCc}` : valueDisplayFormatter(value)
        )}
      </span>

      {/* MIDI Learn Activation Hover Button */}
      {isHovered && !isLearning && onMidiLearn && (
        <button
          onClick={onMidiLearn}
          style={{
            position: 'absolute',
            top: '12px',
            right: '-12px',
            background: 'var(--accent-learn)',
            border: 'none',
            color: 'white',
            borderRadius: '50%',
            width: '14px',
            height: '14px',
            fontSize: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            zIndex: 10,
          }}
          title="Learn MIDI CC"
        >
          L
        </button>
      )}

      {/* Cancel Learn Button */}
      {isLearning && (
        <button
          onClick={onMidiUnbind}
          style={{
            position: 'absolute',
            top: '12px',
            right: '-12px',
            background: '#e06c43',
            border: 'none',
            color: 'white',
            borderRadius: '50%',
            width: '14px',
            height: '14px',
            fontSize: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            zIndex: 10,
          }}
          title="Cancel MIDI Learn"
        >
          ⨉
        </button>
      )}
    </div>
  );
}
