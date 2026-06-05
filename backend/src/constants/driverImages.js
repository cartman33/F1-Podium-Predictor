/** OpenF1/Ergast에 없거나 깨진 헤드샷을 대체하는 로컬 이미지 경로 (프론트 public/drivers) */
const LOCAL_DRIVER_IMAGES = {
    Crawford: '/drivers/jak_crawford.png',
    Lindblad: '/drivers/arvid_lindblad.png',
    Tsunoda: '/drivers/yuki_tsunoda.png',
};

const getLocalDriverImageUrl = (familyName) =>
    LOCAL_DRIVER_IMAGES[familyName] ?? null;

const applyLocalDriverImages = (drivers) =>
    drivers.map((driver) => {
        const localUrl = getLocalDriverImageUrl(driver.familyName);
        if (localUrl) {
            return { ...driver, imageUrl: localUrl };
        }
        return driver;
    });

module.exports = {
    LOCAL_DRIVER_IMAGES,
    getLocalDriverImageUrl,
    applyLocalDriverImages,
};
