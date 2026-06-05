import type { DriverStats } from '../services/api';

interface DriverTableProps {
  drivers: DriverStats[];
}

const DriverTable: React.FC<DriverTableProps> = ({ drivers }) => {
  return (
    <section className="bg-[#15151E] border border-track-grey rounded-lg flex-1 overflow-hidden">
      <div className="p-4 border-b border-track-grey flex justify-between items-center bg-surface-container-lowest">
        <h3 className="font-headline-md text-headline-md uppercase text-f1-white">Driver Telemetry & Odds</h3>
        <button className="text-on-surface-variant hover:text-f1-white">
          <span className="material-symbols-outlined">filter_list</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-track-grey bg-black/20">
              <th className="p-4 font-label-sm text-label-sm text-on-surface-variant uppercase w-16 text-center">Avatar</th>
              <th className="p-4 font-label-sm text-label-sm text-on-surface-variant uppercase w-16 text-center">Rank</th>
              <th className="p-4 font-label-sm text-label-sm text-on-surface-variant uppercase">Driver</th>
              <th className="p-4 font-label-sm text-label-sm text-on-surface-variant uppercase hidden sm:table-cell">Team</th>
              <th className="p-4 font-label-sm text-label-sm text-on-surface-variant uppercase text-right">Pick Count</th>
              <th className="p-4 font-label-sm text-label-sm text-on-surface-variant uppercase text-right">Pick %</th>
            </tr>
          </thead>
          <tbody className="font-body-md text-body-md">
            {drivers.map((driver, index) => {
              const pickPercentage = driver.totalPicks > 0 
                ? ((driver.pickCount / driver.totalPicks) * 100).toFixed(1) 
                : "0.0";
              
              // Use the official headshot URL from the backend if available
              const imageUrl = driver.imageUrl || "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23A0A0B0'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

              return (
                <tr key={driver.driverId} className={`border-b border-track-grey/50 hover:bg-white/5 transition-colors group ${index % 2 === 1 ? 'bg-white/[0.02]' : ''}`}>
                  <td className="p-4 text-center">
                    <div className="w-14 h-14 rounded-full border border-white/10 overflow-hidden shadow-sm bg-[#15151E] mx-auto flex items-center justify-center">
                      {driver.imageUrl ? (
                        <img 
                          alt={driver.familyName} 
                          className="w-full h-full object-cover" 
                          src={imageUrl}
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.onerror = null; // 무한 루프 방지
                            target.src = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23A0A0B0'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";
                            target.className = "w-full h-full object-contain p-2";
                          }}
                        />
                      ) : (
                        <span className="material-symbols-outlined text-track-grey text-3xl">account_circle</span>
                      )}
                    </div>
                  </td>
                  <td className={`p-4 font-stats-number text-stats-number text-center ${index < 3 ? 'text-status-error' : 'text-f1-white'}`}>
                    {index + 1}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col">
                      <div className="font-headline-md text-f1-white text-lg flex items-center gap-2">
                        {driver.givenName} {driver.familyName}
                        <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-on-surface-variant font-mono">{driver.code}</span>
                      </div>
                      <div className="text-xs text-on-surface-variant font-mono">#{driver.permanentNumber}</div>
                    </div>
                  </td>
                  <td className="p-4 text-on-surface-variant hidden sm:table-cell font-label-md text-sm">
                    {driver.teamName || 'Independent'}
                  </td>
                  <td className="p-4 text-right font-label-md text-label-md text-tertiary">
                    {driver.pickCount}
                  </td>
                  <td className="p-4 text-right font-stats-number text-stats-number">
                    {pickPercentage}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default DriverTable;
