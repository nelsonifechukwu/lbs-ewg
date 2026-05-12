import logo from './logo.svg';
import './App.css';
import Welcome from './welcome';
import React from 'react';
import Clock from './clock';

function App() {
  return (
    <div>
    <Welcome name="Elijah" />
    <Welcome name="Sarah" />  
    <Clock />
    </div>
    
  );
}

export default App;
