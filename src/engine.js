export function fifo(lots, quantity) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw Error('Enter a positive share quantity.');
  const sorted = [...lots].sort((a,b)=>a.date.localeCompare(b.date));
  let left=quantity, basis=0; const remaining=[];
  for(const lot of sorted){const used=Math.min(left,lot.qty);basis+=used*(lot.price+lot.fee/lot.qty);left-=used;if(lot.qty-used>1e-8)remaining.push({...lot,qty:lot.qty-used,fee:lot.fee*(lot.qty-used)/lot.qty});}
  if(left>1e-7)throw Error('You cannot sell more shares than you own.');
  return {basis,remaining};
}
export function calculate(lots, q, price, sellFee, buyFee, rate, allowance=0, losses=0){
  if(![price,sellFee,buyFee,rate,allowance,losses].every(Number.isFinite)||price<=0||Math.min(sellFee,buyFee,rate,allowance,losses)<0||rate>100)throw Error('Check your prices, fees and tax settings.');
  const f=fifo(lots,q), proceeds=q*price, gain=proceeds-sellFee-f.basis;
  const usedLoss=Math.min(Math.max(gain,0),losses), usedAllowance=Math.min(Math.max(gain-usedLoss,0),allowance);
  const tax=Math.round(Math.max(0,gain-usedLoss-usedAllowance)*rate)/100;
  const cash=proceeds-sellFee-tax;
  if(cash<=buyFee)throw Error('Fees exceed the available proceeds.');
  return {...f,q,price,proceeds,gain,tax,cash,buyFee,usedLoss,usedAllowance};
}
export function target(result,gain,whole=false){
 if(!Number.isFinite(gain)||gain<0||gain>1000)throw Error('Choose a target between 0% and 1000%.');
 const qty=whole?Math.ceil(result.q*(1+gain/100)-1e-9):result.q*(1+gain/100);
 const price=Math.floor(((result.cash-result.buyFee)/qty+1e-10)*100)/100;
 return {qty,price,drop:(1-price/result.price)*100};
}
