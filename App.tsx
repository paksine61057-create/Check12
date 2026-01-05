
import React, { useState, useEffect } from 'react';
import { Subject, AppStep, Choice, StudentResult, QuestionResult } from './types';
import { analyzeAnswerSheet } from './services/geminiService';

const Navbar = () => (
  <nav className="bg-blue-600 text-white p-4 shadow-md flex justify-between items-center sticky top-0 z-50">
    <div className="flex items-center gap-3">
      <div className="bg-white p-1 rounded-lg">
        <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" /></svg>
      </div>
      <h1 className="text-lg font-bold">ระบบตอดสวบ AI</h1>
    </div>
    <div className="text-[10px] bg-blue-700 px-2 py-1 rounded border border-blue-400 font-mono uppercase">Stable v3.2</div>
  </nav>
);

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.SUBJECT_LIST);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [isKeyProcessed, setIsKeyProcessed] = useState(false);
  const [apiKeyInfo, setApiKeyInfo] = useState({ found: false, source: 'None' });
  const [manualKey, setManualKey] = useState(localStorage.getItem('manual_api_key') || '');

  const checkKeyStatus = () => {
    const key = (typeof process !== 'undefined' && process.env?.API_KEY) || (window as any).API_KEY || localStorage.getItem('manual_api_key');
    setApiKeyInfo({ found: !!key && key.length > 10, source: key ? 'Connected' : 'Missing' });
  };

  useEffect(() => {
    checkKeyStatus();
    const t = setInterval(checkKeyStatus, 3000);
    return () => clearInterval(t);
  }, []);

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1600;
          let w = img.width, h = img.height;
          if (w > h) { if (w > maxDim) { h *= maxDim / w; w = maxDim; } }
          else { if (h > maxDim) { w *= maxDim / h; h = maxDim; } }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
      };
    });
  };

  const toggleChoice = (idx: number) => {
    if (!activeSubject) return;
    const choices: Choice[] = ['ก', 'ข', 'ค', 'ง', null];
    const current = activeSubject.answerKey[idx];
    const nextIdx = (choices.indexOf(current) + 1) % choices.length;
    const newKey = [...activeSubject.answerKey];
    newKey[idx] = choices[nextIdx];
    
    const updated = { ...activeSubject, answerKey: newKey };
    setActiveSubject(updated);
    setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
  };

  const processKeyImage = async (file: File) => {
    if (!activeSubject) return;
    setIsLoading(true); setErrorMessage(null);
    try {
      const base64 = await resizeImage(file);
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true);
      if (data.error) { setErrorMessage(data.error); return; }
      const updated = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updated);
      setIsKeyProcessed(true);
    } catch (err) { setErrorMessage("เกิดข้อผิดพลาดในการประมวลผล"); }
    finally { setIsLoading(false); }
  };

  const processStudentImages = async (files: FileList) => {
    if (!activeSubject) return;
    setIsLoading(true); setErrorMessage(null);
    setProcessingProgress({ current: 0, total: files.length });
    const results = [...activeSubject.results];
    try {
      for (let i = 0; i < files.length; i++) {
        setProcessingProgress({ current: i + 1, total: files.length });
        const base64 = await resizeImage(files[i]);
        const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, false);
        if (data.error) continue;
        const answers: QuestionResult[] = data.answers.map((ans, idx) => ({
          questionNo: idx + 1,
          studentAnswer: ans,
          correctAnswer: activeSubject.answerKey[idx],
          isCorrect: ans === activeSubject.answerKey[idx]
        }));
        results.push({
          id: Math.random().toString(36).substr(2, 9),
          studentNumber: data.studentId || "",
          studentName: data.studentName || "",
          answers,
          totalScore: answers.filter(a => a.isCorrect).length,
          hasError: data.answers.some(a => a === null)
        });
      }
      const updated = { ...activeSubject, results };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
      setCurrentStep(AppStep.VIEW_RESULTS);
    } catch (err) { setErrorMessage("ตรวจแผ่นงานไม่สำเร็จ"); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9]">
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-4">
        
        {/* API Key Section */}
        {!apiKeyInfo.found && currentStep !== AppStep.SUBJECT_LIST && (
          <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-2xl space-y-3">
            <p className="text-amber-800 text-sm font-bold">⚠️ กรุณาตั้งค่า API Key เพื่อเริ่มใช้งาน AI</p>
            <div className="flex gap-2">
              <input type="password" placeholder="AIza..." value={manualKey} onChange={e => setManualKey(e.target.value)} className="flex-1 p-2 rounded-lg border border-amber-200 text-xs" />
              <button onClick={() => { localStorage.setItem('manual_api_key', manualKey); checkKeyStatus(); }} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-bold">บันทึก</button>
            </div>
          </div>
        )}

        {errorMessage && <div className="bg-red-500 text-white p-4 rounded-xl text-sm font-bold shadow-lg animate-bounce">{errorMessage}</div>}

        {isLoading && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-white p-6">
            <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-lg font-bold">กำลังตรวจจับตาราง ก ข ค ง...</p>
            {processingProgress.total > 0 && <p className="text-xs opacity-70 mt-1">แผ่นที่ {processingProgress.current} / {processingProgress.total}</p>}
          </div>
        )}

        {currentStep === AppStep.SUBJECT_LIST && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">รายวิชาของฉัน</h2>
              <button onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold shadow-lg">+ เพิ่มวิชา</button>
            </div>
            {subjects.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-3xl border-2 border-dashed border-gray-200 text-gray-400 font-medium">ยังไม่มีข้อมูลวิชา</div>
            ) : (
              subjects.map(s => (
                <div key={s.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-gray-800">{s.name}</h3>
                    <p className="text-xs text-gray-400">{s.totalQuestions} ข้อ | ตรวจแล้ว {s.results.length} คน</p>
                  </div>
                  <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold">ตรวจงาน</button>
                </div>
              ))
            )}
          </div>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <div className="bg-white p-6 rounded-3xl shadow-lg space-y-4">
            <h2 className="text-center font-bold">สร้างวิชาใหม่</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const name = f.get('name') as string;
              const count = parseInt(f.get('count') as string);
              const newSub = { id: Date.now().toString(), name, totalQuestions: count, answerKey: new Array(count).fill(null), results: [], createdAt: Date.now() };
              setSubjects([...subjects, newSub]); setActiveSubject(newSub); setIsKeyProcessed(false); setCurrentStep(AppStep.CALIBRATE_KEY);
            }} className="space-y-4">
              <input required name="name" placeholder="ชื่อรายวิชา" className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-blue-500" />
              <input required name="count" type="number" placeholder="จำนวนข้อ (เช่น 20)" className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-blue-500" />
              <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold">ถัดไป: สแกนใบเฉลย</button>
            </form>
          </div>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <div className="space-y-4">
            {!isKeyProcessed ? (
              <div className="bg-white p-8 rounded-3xl border-4 border-dashed border-gray-100 text-center space-y-4">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
                </div>
                <h2 className="font-bold">ถ่ายภาพใบเฉลย</h2>
                <p className="text-xs text-gray-400 leading-relaxed">วางใบเฉลยให้ตรงแนว สว่างๆ <br/>AI จะอ่านตามแนวราบ ก ข ค ง</p>
                <div className="relative">
                  <input type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && processKeyImage(e.target.files[0])} />
                  <button className="bg-blue-600 text-white w-full py-3 rounded-xl font-bold shadow-lg">เปิดกล้องถ่ายภาพ</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="bg-green-50 p-4 rounded-2xl border border-green-200 text-center">
                  <h2 className="font-bold text-green-700">สแกนเฉลยเรียบร้อย!</h2>
                  <p className="text-[10px] text-green-600 font-bold uppercase mt-1">💡 หากข้อไหนผิด คลิกที่ตัวเลือกเพื่อแก้ไขได้เลย</p>
                </div>
                
                <div className="bg-white rounded-3xl p-4 shadow-sm grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
                  {activeSubject.answerKey.map((ans, idx) => (
                    <div key={idx} onClick={() => toggleChoice(idx)} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-blue-50 transition border border-transparent hover:border-blue-200">
                      <span className="text-[10px] font-bold text-gray-400">ข้อ {idx + 1}</span>
                      <span className={`font-bold text-lg ${ans ? 'text-blue-600' : 'text-red-400'}`}>{ans || '?'}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setIsKeyProcessed(false)} className="flex-1 py-3 text-gray-400 font-bold">ถ่ายใหม่</button>
                  <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="flex-[2] bg-blue-600 text-white py-3 rounded-xl font-bold shadow-lg">เฉลยถูกต้องแล้ว เริ่มตรวจ</button>
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <div className="space-y-6 text-center">
            <div className="space-y-1">
              <h2 className="font-bold text-xl">ตรวจงานวิชา: {activeSubject.name}</h2>
              <p className="text-xs text-gray-400">สแกนแผ่นงานนักเรียน (1 หรือหลายแผ่นพร้อมกัน)</p>
            </div>
            
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-4">
               <div className="w-20 h-20 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-xl animate-pulse">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
               </div>
               <div className="relative w-full">
                  <input type="file" multiple accept="image/*" capture="environment" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && processStudentImages(e.target.files)} />
                  <button className="bg-blue-600 text-white w-full py-4 rounded-2xl font-bold text-lg shadow-lg">สแกนแผ่นงานนักเรียน</button>
               </div>
               <button onClick={() => setCurrentStep(AppStep.VIEW_RESULTS)} className="text-blue-600 font-bold text-sm">ดูผลลัพธ์ที่ตรวจแล้ว</button>
            </div>
          </div>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <div className="space-y-4">
            <div className="flex justify-between items-end">
              <h2 className="font-bold text-xl leading-none">{activeSubject.name}</h2>
              <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="text-xs font-bold text-gray-400 uppercase">ปิด</button>
            </div>
            
            <div className="space-y-2">
              {activeSubject.results.map(r => (
                <div key={r.id} className="bg-white p-4 rounded-2xl shadow-sm flex justify-between items-center border border-gray-50">
                  <div className="flex gap-3 items-center">
                    <div className="bg-blue-50 text-blue-600 w-10 h-10 rounded-xl flex items-center justify-center font-bold">
                      {r.studentNumber || '?'}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-gray-700">{r.studentName || 'ไม่ทราบชื่อ'}</h4>
                      {r.hasError && <p className="text-[10px] text-amber-500 font-bold">⚠️ มีบางข้ออ่านไม่ออก</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-blue-600">{r.totalScore}</span>
                    <span className="text-[10px] text-gray-300 ml-0.5 font-bold">/{activeSubject.totalQuestions}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 sticky bottom-4">
              <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="flex-1 bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-xl">ตรวจเพิ่ม</button>
              <button onClick={() => window.print()} className="bg-white text-gray-400 px-6 py-4 rounded-2xl font-bold border border-gray-100 shadow-sm">พิมพ์</button>
            </div>
          </div>
        )}
      </main>

      <div className="fixed bottom-0 inset-x-0 p-4 flex justify-center pointer-events-none">
         <div className={`px-4 py-1.5 rounded-full text-[10px] font-bold shadow-lg pointer-events-auto ${apiKeyInfo.found ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
            {apiKeyInfo.found ? 'AI พร้อมทำงาน' : 'AI ยังไม่เชื่อมต่อ'}
         </div>
      </div>
    </div>
  );
};

export default App;
