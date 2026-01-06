
import React, { useState, useEffect } from 'react';
import { Subject, AppStep, Choice, StudentResult, QuestionResult } from './types';
import { analyzeAnswerSheet } from './services/geminiService';

const Navbar = () => (
  <nav className="bg-blue-600 text-white p-4 shadow-md flex justify-between items-center sticky top-0 z-50">
    <div className="flex items-center gap-3">
      <div className="bg-white p-1 rounded-lg">
        <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" /></svg>
      </div>
      <h1 className="text-lg font-bold">ระบบตอดสวบ</h1>
    </div>
    <div className="text-[10px] bg-blue-700 px-2 py-1 rounded border border-blue-400 font-mono">v3.4 Final</div>
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
    } catch (err) { setErrorMessage("ระบบขัดข้อง กรุณาลองใหม่"); }
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
          studentNumber: data.studentId || (results.length + 1).toString(),
          studentName: data.studentName || "ไม่ระบุชื่อ",
          answers,
          totalScore: answers.filter(a => a.isCorrect).length,
          hasError: data.answers.some(a => a === null)
        });
      }
      const updated = { ...activeSubject, results };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
      setCurrentStep(AppStep.VIEW_RESULTS);
    } catch (err) { setErrorMessage("การสแกนล้มเหลว"); }
    finally { setIsLoading(false); }
  };

  const exportToExcel = () => {
    if (!activeSubject) return;
    const headers = ['เลขที่', 'ชื่อ-นามสกุล', 'คะแนนที่ได้', 'คะแนนเต็ม'];
    const rows = activeSubject.results.map(r => [
      `"${r.studentNumber}"`,
      `"${r.studentName}"`,
      r.totalScore,
      activeSubject.totalQuestions
    ]);
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `สรุปผลสอบ_${activeSubject.name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-20">
      <Navbar />
      <main className="max-w-xl mx-auto p-4 space-y-4">
        
        {errorMessage && (
          <div className="bg-red-500 text-white p-4 rounded-2xl text-sm font-bold shadow-lg">
            {errorMessage}
            <button onClick={() => setErrorMessage(null)} className="float-right underline">ปิด</button>
          </div>
        )}

        {isLoading && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-xl font-black text-blue-900">กำลังประมวลผลด้วย AI...</p>
            {processingProgress.total > 0 && <p className="text-blue-600 font-bold mt-2">แผ่นที่ {processingProgress.current} จาก {processingProgress.total}</p>}
          </div>
        )}

        {currentStep === AppStep.SUBJECT_LIST && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">รายวิชา</h2>
              <button onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)} className="bg-blue-600 text-white px-5 py-2.5 rounded-2xl font-bold shadow-md">+ วิชาใหม่</button>
            </div>
            {subjects.length === 0 ? (
              <div className="bg-white p-16 text-center rounded-[2.5rem] border-2 border-dashed border-slate-200 text-slate-400 font-bold">ยังไม่มีข้อมูลวิชา</div>
            ) : (
              subjects.map(s => (
                <div key={s.id} className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-slate-800">{s.name}</h3>
                    <p className="text-xs text-slate-400 font-medium">{s.totalQuestions} ข้อ • ตรวจแล้ว {s.results.length} คน</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); }} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm">ดูผล</button>
                    <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm shadow-sm">ตรวจ</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl space-y-6">
            <h2 className="text-center text-xl font-black">ข้อมูลวิชาใหม่</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const name = f.get('name') as string;
              const count = parseInt(f.get('count') as string);
              const newSub: Subject = { id: Date.now().toString(), name, totalQuestions: count, answerKey: new Array(count).fill(null), results: [], createdAt: Date.now() };
              setSubjects([...subjects, newSub]); setActiveSubject(newSub); setIsKeyProcessed(false); setCurrentStep(AppStep.CALIBRATE_KEY);
            }} className="space-y-4">
              <input required name="name" placeholder="ระบุชื่อวิชา" className="w-full p-4 bg-slate-50 rounded-2xl outline-none focus:ring-2 ring-blue-500 border-none font-medium" />
              <input required name="count" type="number" placeholder="จำนวนข้อ (เช่น 20)" className="w-full p-4 bg-slate-50 rounded-2xl outline-none focus:ring-2 ring-blue-500 border-none font-medium" />
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg">ถัดไป: สแกนเฉลย</button>
            </form>
            <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="w-full text-slate-400 font-bold">ยกเลิก</button>
          </div>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <div className="space-y-4">
            <div className="bg-white p-10 rounded-[3rem] border-4 border-dashed border-slate-100 text-center space-y-6">
              <h2 className="font-black text-xl">{isKeyProcessed ? 'ยืนยันเฉลย' : 'เลือกใบเฉลย'}</h2>
              {!isKeyProcessed ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-400">ถ่ายรูปหรือเลือกไฟล์ใบเฉลยที่ฝนคำตอบไว้แล้ว</p>
                  <label className="block w-full bg-blue-600 text-white py-4 rounded-2xl font-black cursor-pointer shadow-lg text-center">
                    📸 เลือก/ถ่ายภาพเฉลย
                    <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files && processKeyImage(e.target.files[0])} />
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-2 max-h-60 overflow-y-auto p-2">
                  {activeSubject.answerKey.map((ans, i) => (
                    <div key={i} className="text-center p-2 bg-slate-50 rounded-lg">
                      <div className="text-[10px] text-slate-400">ข้อ {i+1}</div>
                      <div className="font-bold text-blue-600">{ans || '-'}</div>
                    </div>
                  ))}
                </div>
              )}
              {isKeyProcessed && (
                <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg">ตกลง และเริ่มตรวจข้อสอบ</button>
              )}
            </div>
          </div>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <div className="bg-white p-10 rounded-[3rem] text-center space-y-6 shadow-xl">
            <h2 className="font-black text-xl">ตรวจข้อสอบนักเรียน</h2>
            <p className="text-sm text-slate-400">ถ่ายรูปหรือเลือกภาพถ่ายใบงานนักเรียน (เลือกได้หลายไฟล์)</p>
            <label className="block w-full bg-blue-600 text-white py-4 rounded-2xl font-black cursor-pointer shadow-lg">
              📂 เลือก/ถ่ายรูปภาพตรวจ
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => e.target.files && processStudentImages(e.target.files)} />
            </label>
            <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="w-full text-slate-400 font-bold">กลับหน้าหลัก</button>
          </div>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-black text-slate-800">สรุปคะแนน: {activeSubject.name}</h2>
                <button onClick={exportToExcel} className="bg-green-600 text-white px-4 py-2 rounded-xl font-bold text-sm shadow-md">📊 ส่งออก Excel</button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-slate-100">
                    <tr>
                      <th className="py-3 px-2 text-[10px] font-black text-slate-400 uppercase">เลขที่</th>
                      <th className="py-3 px-2 text-[10px] font-black text-slate-400 uppercase">ชื่อ</th>
                      <th className="py-3 px-2 text-[10px] font-black text-slate-400 uppercase text-right">คะแนน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSubject.results.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50 last:border-none">
                        <td className="py-4 px-2 font-mono text-sm">{r.studentNumber}</td>
                        <td className="py-4 px-2 font-bold text-slate-700 text-sm">{r.studentName}</td>
                        <td className="py-4 px-2 text-right">
                          <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-black text-sm">
                            {r.totalScore}/{activeSubject.totalQuestions}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {activeSubject.results.length === 0 && (
                  <div className="py-10 text-center text-slate-300 font-bold italic">ยังไม่มีข้อมูล</div>
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg">ตรวจเพิ่ม</button>
              <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="bg-slate-200 text-slate-600 py-4 rounded-2xl font-black">กลับหน้าหลัก</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
