
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

const getSafeApiKey = (): string => {
  let key = "";
  try {
    const envKey = (typeof process !== 'undefined' && process.env?.API_KEY) ? process.env.API_KEY : "";
    const windowKey = (window as any).API_KEY || "";
    const manualKey = localStorage.getItem('manual_api_key') || "";
    key = envKey || windowKey || manualKey || "";
  } catch (e) {
    key = localStorage.getItem('manual_api_key') || (window as any).API_KEY || "";
  }
  return key.toString().trim().replace(/^['"]|['"]$/g, '');
};

const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return text.substring(start, end + 1);
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

const mapToChoice = (val: any): Choice => {
  if (val === null || val === undefined) return null;
  const v = String(val).trim().toUpperCase();
  if (v === 'ก' || v === 'A' || v === '1' || v === 'COL1') return 'ก';
  if (v === 'ข' || v === 'B' || v === '2' || v === 'COL2') return 'ข';
  if (v === 'ค' || v === 'C' || v === '3' || v === 'COL3') return 'ค';
  if (v === 'ง' || v === 'D' || v === '4' || v === 'COL4') return 'ง';
  if (v === 'MULTIPLE' || v === 'M') return 'multiple';
  return null;
};

export const analyzeAnswerSheet = async (
  base64Image: string,
  totalQuestions: number,
  isKey: boolean = false
): Promise<{ 
  answers: Choice[], 
  studentId?: string, 
  studentName?: string,
  error?: string,
  isAuthError?: boolean
}> => {
  try {
    const apiKey = getSafeApiKey();
    if (!apiKey || apiKey.length < 5) {
      return { answers: [], error: "กรุณาเชื่อมต่อ API Key ก่อน", isAuthError: true };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // คำสั่งที่ชัดเจนที่สุด: มองเป็นตาราง 4 ช่อง ก-ง
    const systemInstruction = `You are a simple OMR grid reader.
Rules:
1. Identify markings for questions 1 to ${totalQuestions}.
2. Each question is a row with 4 horizontal columns: Column 1=ก, Column 2=ข, Column 3=ค, Column 4=ง.
3. If a box is ticked, crossed, or shaded, mark that column.
4. Return JSON format: {"questions": [{"id": 1, "marked": "ก"}]}.
${isKey ? '' : '5. Also find student name/ID at the top and include in "studentNumber" and "studentName".'}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: `Identify marks for 1-${totalQuestions} questions.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  marked: { type: Type.STRING, nullable: true }
                },
                required: ["id", "marked"]
              }
            },
            studentNumber: { type: Type.STRING },
            studentName: { type: Type.STRING }
          },
          required: ["questions"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("API No Response");
    
    const data = JSON.parse(cleanJsonResponse(text));
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions) {
      data.questions.forEach((q: any) => {
        const idx = q.id - 1;
        if (idx >= 0 && idx < totalQuestions) answers[idx] = mapToChoice(q.marked);
      });
    }

    return {
      answers,
      studentId: data.studentNumber || "",
      studentName: data.studentName || ""
    };
  } catch (err: any) {
    return { 
      answers: [], 
      error: "AI เข้าถึงภาพไม่ได้ (Inference Error) กรุณาถ่ายภาพในที่สว่างและชัดเจนขึ้น หรือลองกดใหม่อีกครั้ง" 
    };
  }
};
