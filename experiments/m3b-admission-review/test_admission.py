import unittest
from admission import decode,differences
def sample():
    w=[0]*128;w[:3]=[0x4d334241,1,128];w[16]=5;w[19]=3;w[20]=1;w[21]=1;w[37]=1;w[48]=3;w[51]=2;w[8]=9;w[9]=0x123;w[10]=0x456;w[12]=0x1000;w[64]=0x1234;w[65]=0x7f00;w[66]=0x123;w[67]=0x456;w[68]=2;w[69]=512;w[70]=5;w[72]=0x123456;w[96]=0x8b48;return w
class AdmissionTests(unittest.TestCase):
    def test_full_partition_and_overlapping_reasons(self):
        row=decode(sample(),0);self.assertEqual(row['counters']['translations'],5);self.assertEqual(row['lastDecode']['bytesHex'],'488b');self.assertEqual(row['lastDecode']['pc'],'0x7f0000001234');self.assertEqual(sum(row['rejections'].values()),5)
    def test_all_rejected_corruptions(self):
        for index,value in [(3,1),(71,1),(16,6),(37,2),(24,1),(25,1),(48,4),(97,1),(68,0),(68,129),(69,513),(70,8),(8,256)]:
            with self.subTest(index=index,value=value):
                w=sample();w[index]=value
                with self.assertRaises(ValueError):decode(w,0)
    def test_trial_equality(self):
        w=sample();w[37]=0;w[32]=1;w[70]=0;decode(w,1)
        with self.assertRaises(ValueError):decode(w,0)
    def test_zero_and_reset(self):
        w=[0]*128;w[:3]=[0x4d334241,1,128];decode(w,0,True)
        with self.assertRaises(ValueError):decode(sample(),0,True)
        with self.assertRaises(ValueError):differences({'a':1},{'a':0})
if __name__=='__main__':unittest.main()
